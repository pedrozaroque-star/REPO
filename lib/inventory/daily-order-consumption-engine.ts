/**
 * @module lib/inventory/daily-order-consumption-engine
 * @description Motor unificado determinista para calcular el consumo exacto de insumos de
 *              la Orden Diaria de Bodega a partir de tickets completos de Toast POS en Tacos Gavilan.
 *
 * @businessRules
 *   - Solo calcula insumos de la Orden Diaria de Bodega (alimentos, carnes, tortillas, quesos,
 *     preparados, salsas, y suministros internos). Viele & Sons permanece manual y excluido.
 *   - Procesa tickets completos con selecciones, modificadores anidados y canales de venta/empaque.
 *   - Recetas de carnes aplican rendimientos oficiales calibrados (yield %):
 *     Asada: 61.5%, Pastor: 53.0%, Pollo: 57.5%, Cabeza: 78.5%,
 *     Lengua: 92.5%, Carnitas: 100%, Buche: 100%, Chorizo: 67.0%.
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
 *       - 1 por burrito / super burrito (sin factor artificial de rotura: 0% scrap).
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
 *     * Burritos regulares/super: 4 oz arroz en peso (cuchara volumétrica de 6 fl oz) y 4 oz frijol molido.
 *     * Taco Plate y Platos combinados: 4 oz arroz y 4 oz frijol molido.
 *     * Órdenes individuales (Sides): 6 oz arroz (vaso 8 oz), 8 oz frijol molido (vaso 8 oz), 4 oz frijol entero (vaso 4 oz).
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
 *   - [2026-09-30] Torta Milanesa consume 2 piezas y Plato Milanesa / Side Order Carne (Milanesa) 3 piezas,
 *     según la regla operativa confirmada por Carlos; la bolsa del catálogo contiene 20 piezas.
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
 *   - [2026-11-09] Confirmado por Carlos: Quesadillas regulares y Super Quesadillas,
 *     Burritos, Nachos, Platos y Tortas llevan 6.0 oz de carne cocida base (+6.0 oz con
 *     Extra/Doble Carne); Meat Only Burrito regular y Super llevan 12.0 oz base (+6.0 oz
 *     con Extra/Doble Carne) sin arroz ni frijol; `applyNamedMeatPortion` (Half 50/50 +
 *     Extra Carne) aplica en Mulitas, Tortas, Sopes, Quesadillas y Nachos, y Party Trays
 *     detectan las 8 proteínas activas. Se elimina el +7.8% de merma artificial en tortilla
 *     de harina 13" y se blindan los divisores físicos de Salsa Huevos Rancheros (2.30 lb)
 *     y Bolsa Aguacate (2.0 lb) frente a `quantity_per_unit = 0.5` del catálogo legado.
 *   - [2026-11-11] Blindaje de resolución determinista por UUID canónico (`ACTIVE_DAILY_ORDER_ITEM_IDS`)
 *     antes del fallback por nombre (`findItemByName`). Evita que filas legadas duplicadas en
 *     `inventory_items` (ej. `3c48a147...` "1100Y Tortilla, Tacos y Platos" frente al SKU activo
 *     de plantilla diaria `dcd79433...` "1100 Tortilla,White Corn 4.7OZ 60CT") capturen el consumo
 *     según el orden de lectura o paginación de PostgreSQL.
 *   - [2026-11-23] Alineada combinación aditiva `Carne Dorada + Extra/Doble/Double Meat` en tacos
 *     (`(isExtra ? 3.0 : 1.5) + (isDorada ? 0.4 : 0) = 3.4 oz`) para paridad 1:1 con `meat-allocation.ts`.
 *   - [2026-11-25] Excluidos marcadores no alimentarios (`Policia` `d8f4d7cc...`, notas abiertas Toast
 *     `0c592b57...`, `Borrar`, `Pu`, `P U`); soporte de unidades `fl oz`, `1 Gallon`/`gal` y `unit` sin `NaN`;
 *     alias `chicken -> pollo`, aditivos `Extra <Proteína>` y `Extra Nacho Cheese`; soporte de modificadores
 *     de carne/queso/aguacate/crema/exclusiones en desayunos `/huevos?/`; y descuento exacto por cantidad de
 *     ocurrencias en modificadores `No ...` tanto en `ordersBulk` como en `PMIX` agregado sin doble multiplicación.
 *   - [2026-11-25] Calibraciones confirmadas por Carlos: `Burrito Beans & Cheese` (sin arroz/carne) = `8.0 oz` Frijol Molido;
 *     `Super Nachos` = `5.0 oz` Amarillo Cheese (`0 oz` Frijol); `029W Queso Fresco` NO se descuenta en Tortas regulares
 *     porque su costo/facturación QBO (95.5%) va incluido 1:1 dentro de `271W Papelito Para Torta` (evita doble conteo);
 *     solo aplica vía receta DB en `Torta Queso`, `Sope Queso`, `Side Order Queso Fresco` y modificador `Extra Queso Fresco` (`+1 pza`);
 *     `026W Queso Rayado` = `0 oz` base en Mulitas y Platos, `0.6 oz` en modificadores de Taco/Mulita/Sope y `2.1 oz`
 *     en Burritos (regular, huevo o extra sobre Super Burrito), Platos, Quesadillas y Nachos.
 */

import { PARTY_TRAY_GUIDELINES, resolvePartyTraySize } from './party-tray-guidelines'
import {
  MEAT_COOKING_YIELDS,
  ACTIVE_PROTEIN_IDS,
  detectNonGrillSideProteinKind,
  parseProteinAllocation,
  type ActiveProteinKey,
} from './meat-allocation'
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

const canonicalizeUnitToken = (raw: string | null | undefined, fallbackUnitType?: string | null): string => {
  const u = normalize(raw)
  if (u === '1 gallon' || u === 'gallon' || u === 'gal' || u === 'galon' || u === 'galones') return 'gal'
  if (u === 'unit' || u === 'each' || u === 'ea' || u === 'pieza' || u === 'piezas' || u === 'pcs' || u === 'pza') return 'pza'
  if (u === '1 dz' || u === 'dz' || u === 'docena' || u === 'dozen') return 'dz'
  if (u === 'fl oz' || u === 'floz' || u === 'fluid oz') return 'fl oz'
  if (u === 'oz' || u === 'onza' || u === 'onzas') return 'oz'
  if (u === 'lb' || u === 'lbs' || u === 'libra' || u === 'libras') return 'lb'
  if (!u && fallbackUnitType && /gallon|\bgal\b/i.test(fallbackUnitType)) return 'gal'
  return u
}

const convertRecipeAmountToCatalogMeasure = (
  amount: number,
  rawRecipeUnit: string | null | undefined,
  item: InventoryItemCatalogEntry | undefined
): number => {
  const rUnit = canonicalizeUnitToken(rawRecipeUnit)
  const iMeasure = canonicalizeUnitToken(item?.unit_measure, item?.unit_type)
  const hasGallonUnitType = /gallon|\bgal\b/i.test(String(item?.unit_type || ''))
  if (rUnit === iMeasure) return amount
  if (rUnit === 'dz' && iMeasure === 'pza') return amount * 12
  if (rUnit === 'pza' && iMeasure === 'dz') return amount / 12
  if ((rUnit === 'oz' || rUnit === 'fl oz') && (iMeasure === 'oz' || iMeasure === 'fl oz')) return amount
  if ((rUnit === 'oz' || rUnit === 'fl oz') && iMeasure === 'lb') return amount / 16
  if (rUnit === 'lb' && (iMeasure === 'oz' || iMeasure === 'fl oz')) return amount * 16
  if ((rUnit === 'oz' || rUnit === 'fl oz') && (iMeasure === 'gal' || hasGallonUnitType)) return amount / 128
  if (rUnit === 'gal' && (iMeasure === 'oz' || iMeasure === 'fl oz')) return amount * 128
  if (rUnit === 'gal' && hasGallonUnitType) return amount
  return NaN
}

const isNonFoodPosMarker = (guid: string | null | undefined, normalizedName: string): boolean => {
  if (guid === 'd8f4d7cc-e98c-4953-babc-cbb05e96a33d') return true // Policia (marcador de descuento/cortesía)
  if (guid === '0c592b57-dc09-4e81-8822-79ee02e9ef24') return true // Toast Open Note / Special Request libre
  if (/separator|separador|add\s*value|test\s*item|^test$/.test(normalizedName)) return true
  if (/^(?:policia|pu|p\s+u|borrar(?:\s*[^\w\s]+)*|bolsa\s+apa(?:rte|dte))$/.test(normalizedName)) return true
  return false
}

/**
 * Factores de merma operativa comprobados empíricamente en Lynwood #14:
 * - Maíz 1100 (60ct): +6.5% por merma de comal (pegado/quemado), limpieza y tortillas extra en platos.
 * - Harina 13" Burrito (1 dz): 0% (conteo puro 1:1 por burrito; se eliminó el +7.8% no validado).
 */
export const CORN_TORTILLA_GRILL_SCRAP_FACTOR = 0.065
export const BURRITO_TORTILLA_TEAR_SCRAP_FACTOR = 0

/**
 * UUIDs canónicos activos de la plantilla de Orden Diaria (`store_order_template` / `recipes`)
 * en las 15 sucursales de Tacos Gavilan. Garantizan resolución O(1) determinista y evitan
 * colisiones con filas legadas duplicadas de `inventory_items`.
 */
export const ACTIVE_DAILY_ORDER_ITEM_IDS = {
  cornTortillas: 'dcd79433-e97c-46dc-80c0-8429401e0fa0',
  burritoTortillas: '55798c3c-a86e-469d-ab70-24e0f1af0c2b',
  regular8Tortillas: '1df90372-7648-4ec1-9a6c-fca4032095a6',
  mulitas: 'c94028ef-cdc5-4173-9686-9eeaa1a76510',
  teleras: '8322778b-a978-478f-8508-a1332ea09551',
  milanesa: '5c59d80c-7d7b-45f9-997c-57540127d3a8',
  jamon: '5a962d06-d162-425e-a942-c7ad6dab663d',
  salchicha: 'cac598b2-9c18-4055-8f2e-16de22d78535',
  sopes: '983a3a9a-446a-4b98-b26b-3c3e642508a0',
  nachoChips: 'dbadf821-79dc-4c1a-9b68-907bb9c8c112',
  huevos: '15871ef1-768e-4176-978e-346edb2006eb',
  arroz: 'a1bbc13a-a481-4b7f-a5c6-8a44a96ad562',
  frijolMolido: '557d9414-c769-4399-a6cc-15bb81cba85f',
  frijolEntero: '88a992db-c021-4719-88f9-58c70302392e',
  salsaRanchera: '202c48b0-f9f9-4304-87a5-07d5e970f0cf',
  quesadillaBodega: '0ae260b8-ec71-4b4f-a38f-e3b81f84f720',
  quesoRayado: '525a859d-9f16-477b-9a30-a56abeb4ec14',
  quesoFresco: '34720160-015c-4623-bb1e-98da0e7b4e51',
  quesoCotija: '6549dc7d-7657-4bbd-851e-153707b4556b',
  crema: '0166aec7-160a-4c9c-82d4-9ecbb251cb9d',
  mayonesa: '3ab4f8a4-97dc-4949-903c-82102cffbb03',
  papelitoTorta: 'fb83420e-8c32-4e85-a29d-e74de2055807',
  vivaLard: 'cbb0ce87-dac0-4741-a4f1-f9d2911fcaf1',
  flan: 'f8f776c5-3b8c-453e-8161-b49840823933',
  cheesecake: '8ba55664-5ca9-4886-8ac8-acf1fd070713',
  amarilloCheese: '62968b74-7877-4650-aa43-4ec6e9eb1888',
  aguacate: '0289794f-e7e1-4a65-9492-56ca6b6767e9',
  salsaRojaPackets: 'a639ad41-81bf-4de6-8dbc-0291005654ad',
  salsaVerdePackets: '6c0a3378-8309-48c9-a438-15313cabd9d8',
  mixtaPackets: '90fb17e3-6ba7-4545-b5a1-94df4f6a9fcb',
  limaPackets: 'f73fe7a6-105c-4624-a87b-07d5f78c09ea',
  jalapenoBulk: 'd56d8df8-d30c-4964-a425-9aa25d962364',
  salsaRojaGallon: 'aa8d2711-fbd7-45b7-9223-52a2722ffd0e',
  salsaVerdeGallon: '68a502a5-7e28-4b63-a830-47b9acb91bdf',
  galonesVacios: '2fba5d5d-2af8-437d-8eae-844ed531dd8d',
  horchata: '085ecb0d-c711-4134-ae1a-f7630a22759c',
  tamarindo: 'b6f3f5de-c554-4650-b0df-09dd5d3ca053',
  jamaica: '6051e960-7564-41f6-9a52-ff79ed7c6353',
  pina: '9851a32c-dc35-4653-a1e4-b2cf7bac9009',
  champurrado: '808c43e2-df89-4b6d-bef3-2f5c7310914c',
} as const

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

  // Mapeo canónico de insumos clave de Bodega (UUID canónico primero; fallback por nombre para tests unitarios)
  const findItemByName = (patterns: RegExp[]): InventoryItemCatalogEntry | undefined => {
    return inventoryItems.find(i => {
      const n = normalize(i.name)
      const ref = normalize(i.excel_reference)
      return patterns.some(p => p.test(n) || p.test(ref))
    })
  }
  const resolveCanonicalItem = (canonicalId: string, patterns: RegExp[]): InventoryItemCatalogEntry | undefined =>
    invMap.get(canonicalId) || findItemByName(patterns)

  const itemCornTortillas = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.cornTortillas, [/1100\s*tortilla/i, /tortillas?,\s*tacos?\s*y\s*platos?/i])
  const itemBurritoTortillas = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.burritoTortillas, [/358-9673bt/i, /tortillas?,\s*burritos?/i])
  const itemRegular8Tortillas = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.regular8Tortillas, [/358_9604bt/i, /tortilla\s*regular\s*8\s*in/i])
  const itemMulitas = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.mulitas, [/mulitas?\s*con\s*queso/i, /^mulitas?$/i])
  const itemTeleras = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.teleras, [/^teleras?$/i])
  const itemMilanesa = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.milanesa, [/^milanesa$/i, /^milaneza$/i])
  const itemJamon = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.jamon, [/^jamon\s*pack$/i])
  const itemSalchicha = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.salchicha, [/^salchicha\s*bag$/i])
  const itemSopes = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.sopes, [/^sopes?$/i])
  const itemNachoChips = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.nachoChips, [/tortillas?,\s*nachos?/i, /tortilla\s*nacho/i])
  const itemHuevos = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.huevos, [/^huevo$/i, /huevos?\/eggs?/i])
  const itemArroz = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.arroz, [/^arroz$/i])
  const itemFrijolMolido = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.frijolMolido, [/^frijol\s*molido$/i])
  const itemFrijolEntero = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.frijolEntero, [/^frijol\s*entero$/i])
  const itemSalsaRanchera = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.salsaRanchera, [/^salsa\s*huevos?\s*rancheros?$/i])
  const itemQuesadillaBodega = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.quesadillaBodega, [/^quesadilla\s*bodega$/i])
  const itemQuesoRayado = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.quesoRayado, [/^queso\s*rayado/i])
  const itemQuesoFresco = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.quesoFresco, [/^queso\s+tortas\/platos\/desayuno$/i, /queso\s*fresco/i])
  // Orden Diaria usa Cotija 021 de 12 oz; el Cotija 002df de 5 lb es otro SKU.
  const itemQuesoCotija = invMap.get(ACTIVE_DAILY_ORDER_ITEM_IDS.quesoCotija) || inventoryItems.find(i =>
    /^queso\s*cotija\s*021/i.test(normalize(i.name)) &&
    normalize(i.unit_measure) === 'oz' && Number(i.quantity_per_unit) === 12
  )
  const itemCrema = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.crema, [/^bolsa\s*crema/i])
  const itemMayonesa = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.mayonesa, [/^bolsa\s*mayonesa/i])
  const itemPapelitoTorta = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.papelitoTorta, [/papelito\s*para\s*torta/i, /papelitos?\s*tortas?/i])
  const itemVivaLard = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.vivaLard, [/viva\s*lard/i])
  const itemFlan = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.flan, [/^flan$/i])
  const itemCheesecake = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.cheesecake, [/^cheesecake$/i])
  const itemAmarilloCheese = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.amarilloCheese, [/amarillo\s*cheese/i, /queso\s*amarillo/i])
  const itemAguacate = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.aguacate, [/^bolsa\s*aguacate/i, /^aguacate\s*2\s*lbs?/i, /^aguacate$/i])
  const itemSalsaRojaPackets = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.salsaRojaPackets, [/^1\.5\s*oz\s*salsa\s*roja\s*pack$/i])
  const itemSalsaVerdePackets = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.salsaVerdePackets, [/^1\.5\s*oz\s*salsa\s*verde\s*pack$/i])
  const itemMixtaPackets = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.mixtaPackets, [/^1\s*oz\s*bolsa\s*de\s*mixta$/i])
  const itemLimaPackets = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.limaPackets, [/^lima\s*bolsita$/i])
  const itemJalapenoBulk = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.jalapenoBulk, [/^rajas\s*y\s*zanahorias$/i])
  const itemSalsaRojaGallon = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.salsaRojaGallon, [/^salsa\s*roja$/i])
  const itemSalsaVerdeGallon = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.salsaVerdeGallon, [/^salsa\s*verde$/i])
  const itemGalonesVacios = resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.galonesVacios, [/^galones\s+vacios$/i])

  const itemAguas: Record<string, InventoryItemCatalogEntry | undefined> = {
    horchata: resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.horchata, [/^horchata$/i]),
    tamarindo: resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.tamarindo, [/tamarindo/i]),
    jamaica: resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.jamaica, [/jamaica/i]),
    pina: resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.pina, [/pina|piña/i]),
    champurrado: resolveCanonicalItem(ACTIVE_DAILY_ORDER_ITEM_IDS.champurrado, [/champurrado/i]),
  }

  const itemMeats: Record<string, InventoryItemCatalogEntry | undefined> = {
    asada: invMap.get(ACTIVE_PROTEIN_IDS.asada) || findItemByName([/carne\s*asada/i]),
    pastor: invMap.get(ACTIVE_PROTEIN_IDS.pastor) || findItemByName([/^pastor$/i]),
    pollo: invMap.get(ACTIVE_PROTEIN_IDS.pollo) || findItemByName([/^pollo$/i]),
    cabeza: invMap.get(ACTIVE_PROTEIN_IDS.cabeza) || findItemByName([/^cabeza$/i]),
    lengua: invMap.get(ACTIVE_PROTEIN_IDS.lengua) || findItemByName([/^lengua$/i]),
    chorizo: invMap.get(ACTIVE_PROTEIN_IDS.chorizo) || findItemByName([/^chorizo/i]),
    carnitas: invMap.get(ACTIVE_PROTEIN_IDS.carnitas) || findItemByName([/^carnitas/i]),
    buche: invMap.get(ACTIVE_PROTEIN_IDS.buche) || findItemByName([/^buche/i]),
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
  let quesoFrescoCount = 0
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
      return name !== 'empleado' && !isNonFoodPosMarker(selection.guid, name)
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
      // En Toast `ordersBulk` (`selQty=3, modQty=3` o `selQty=1, modQty=1`) y en `pmix_daily_cache`
      // (`selQty=60, modQty=3`), `mod.qty` expresa el conteo exacto de instancias del modificador
      // sobre la línea: jamás volver a multiplicarlo por `sQty`.
      const sumModUnits = (predicate: (m: (typeof mods)[number]) => boolean): number => {
        let total = 0
        for (const m of mods) {
          if (!predicate(m)) continue
          if (Number.isFinite(m.qty) && m.qty > 0) total += m.qty
        }
        return Math.min(sQty, total)
      }
      const countRemovedUnits = (pattern: RegExp): number => {
        const matching = mods.filter(m => pattern.test(m.norm))
        for (const mod of matching.filter(m => !Number.isFinite(m.qty) || m.qty <= 0 || m.qty > sQty)) {
          const key = `ambiguous_removal:${selectionKey}:${mod.norm}`
          if (!uncoveredMap.has(key)) uncoveredMap.set(key, { guid: sel.guid || 'NO_GUID',
            name: `${sName} (exclusión parcial/ambigua: ${mod.name})`, qty: sQty })
        }
        return sumModUnits(m => pattern.test(m.norm))
      }
      const removedAvocado = countRemovedUnits(/^(?:no|sin)\s+(?:guacamole|aguacate|avocado)\b/)
      const removedCrema = countRemovedUnits(/^(?:no|sin)\s+(?:sour\s*cream|crema)\b/)
      const removedMayo = countRemovedUnits(/^(?:no|sin)\s+(?:mayo|mayonesa)\b/)
      const removedQuesoFresco = countRemovedUnits(/^(?:no|sin)\s+queso\s+fresco\b/)
      const removedCotija = countRemovedUnits(/^(?:no|sin)\s+(?:cotija|queso(?!\s+fresco))\b/)
      const removedJack = countRemovedUnits(/^(?:no|sin)\s+(?:jack(?:\s+cheese)?|cheese|queso(?!\s+fresco))\b/)
      const removedRice = /^(?:solo\s+frijol(?:es)?|meat\s*only)\b/.test(normName)
        ? sQty
        : countRemovedUnits(/^(?:no|sin)\s+(?:rice|arroz)\b|^solo\s+frijol(?:es)?\b|^meat\s*only\b/)
      const removedBeans = /^(?:solo\s+arroz|meat\s*only)\b/.test(normName)
        ? sQty
        : countRemovedUnits(/^(?:no|sin)\s+(?:beans?|frijol(?:es)?)\b|^solo\s+arroz\b|^meat\s*only\b/)

      const keptAvocadoQty = Math.max(0, sQty - removedAvocado)
      const keptCremaQty = Math.max(0, sQty - removedCrema)
      const keptMayoQty = Math.max(0, sQty - removedMayo)
      const keptCotijaQty = Math.max(0, sQty - removedCotija)
      const keptJackQty = Math.max(0, sQty - removedJack)
      const keptRiceQty = Math.max(0, sQty - removedRice)
      const keptBeansQty = Math.max(0, sQty - removedBeans)
      const noAvocado = keptAvocadoQty === 0
      const noJack = keptJackQty === 0

      const isJackCheeseAddMod = (m: (typeof mods)[number]) =>
        !/nacho|fresco|cotija/.test(m.norm) &&
        /^(?:(?:extra\s+)?jack\s+cheese|extra\s+(?:cheese|queso)|queso\s+jack)\b/.test(m.norm)
      const addedJackUnitsForCheck = sumModUnits(m => /^jack\s+cheese\b/.test(m.norm))
      if (removedJack > 0 && addedJackUnitsForCheck > 0 && removedJack + addedJackUnitsForCheck > sQty) {
        const key = `contradictory_cheese:${selectionKey}`
        const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID',
          name: `${sName} (No Cheese y Jack Cheese simultáneos; queso pendiente)`, qty: 0 }
        prior.qty += Math.min(sQty, removedJack + addedJackUnitsForCheck - sQty)
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
      const proteinPatterns: Array<[ActiveProteinKey, RegExp]> = [
        ['asada', /\basada\b/],
        ['pastor', /\bpastor\b/],
        ['pollo', /\b(?:pollo|chicken)\b/],
        ['cabeza', /\bcabeza\b/],
        ['lengua', /\blengua\b/],
        ['chorizo', /\bchorizo\b/],
        ['carnitas', /\bcarnitas\b/],
        ['buche', /\bbuche\b/],
      ]
      const resolveProteinToken = (txt: string): ActiveProteinKey | undefined =>
        proteinPatterns.find(([, rx]) => rx.test(txt))?.[0]
      const explicitExtraProteinModRx =
        /^(?:extra|doble|double)(?:\s+(?:meat|carne))?(?:[\s:/-]+(?:de\s+)?)?(asada|pastor|pollo|chicken|cabeza|lengua|chorizo|carnitas|buche)(?:\s+\d+(?:\.\d+)?\s*oz)?(?:\s*\(in store\))?$/
      const halfProteinModRx =
        /^(?:half|mitad)\s+(asada|pastor|pollo|chicken|cabeza|lengua|chorizo|carnitas|buche)(?:\s*\(in store\))?$/
      const genericExtraMeatModRx =
        /^(?:extra|doble|double)\s+(?:carne|meat)(?:\s+\d+(?:\.\d+)?\s*oz)?(?:\s*\(in store\))?$/

      const applyExplicitExtraProteinModifiers = (unitExtraOz: number) => {
        for (const mod of mods) {
          if (!explicitExtraProteinModRx.test(mod.norm)) continue
          const extraProt = resolveProteinToken(mod.norm)
          if (!extraProt) continue
          const mUnits = Math.min(sQty, Number.isFinite(mod.qty) && mod.qty > 0 ? mod.qty : sQty)
          cookedMeatOz[extraProt] += unitExtraOz * mUnits
        }
      }

      const applyExtraNachoCheeseModifiers = () => {
        for (const mod of mods) {
          const isNachoCheeseGuid =
            mod.guid === '46f9c375-236d-4dc7-a9e0-5f4c71478a93' ||
            mod.guid === '39ccd866-87b9-4462-b8d1-3764e95eee85' ||
            mod.guid === 'e6d885a5-5b79-484c-bf79-7f8651bc8a25' ||
            (isNachos && mod.guid === '490ec13b-980b-44b3-8baf-205ef27ab085')
          const isNachoCheeseText =
            /^(?:extra\s+)?nacho\s+cheese\b/.test(mod.norm) ||
            (isNachos && /^(?:extra\s+)?queso(?:\s+amarillo)?(?:\s*\(in store\))?$/.test(mod.norm))
          if (!isNachoCheeseGuid && !isNachoCheeseText) continue
          const mUnits = Math.min(sQty, Number.isFinite(mod.qty) && mod.qty > 0 ? mod.qty : 1)
          const modRecRows = mod.guid ? recipesByGuid.get(mod.guid) || [] : []
          const amarilloRow = modRecRows.find(r => r.inventory_item_id === itemAmarilloCheese?.id && ['food', 'raw', 'cooked'].includes(r.type))
          const ozPerUnit = amarilloRow
            ? (normalize(amarilloRow.unit) === 'lb' ? Number(amarilloRow.quantity) * 16 : Number(amarilloRow.quantity))
            : /1\.5\s*oz/.test(mod.norm) ? 1.5 : 4.0
          if (Number.isFinite(ozPerUnit) && ozPerUnit > 0) {
            quesoAmarilloOz += ozPerUnit * mUnits
          }
        }
      }

      const applyNamedMeatPortion = (baseUnitOz: number, unitExtraOzOverride?: number): boolean => {
        const base = resolveProteinToken(normName)
        if (!base) return false
        const genericExtraUnits = sumModUnits(m => genericExtraMeatModRx.test(m.norm))
        const unitExtraOz = unitExtraOzOverride ?? (baseUnitOz <= 1.95 ? 1.5 : 6.0)
        const halfModifiers = mods.filter(m => /^(?:half|mitad)\s+/.test(m.norm))
        const halves = halfModifiers.map(m => (halfProteinModRx.test(m.norm) ? resolveProteinToken(m.norm) : undefined))
        const distinctHalves = [...new Set(halves.filter((p): p is ActiveProteinKey => !!p && p !== base))]
        const totalHalfUnits = halfModifiers.reduce((acc, m, idx) => (halves[idx] && halves[idx] !== base && Number.isFinite(m.qty) && m.qty > 0 ? acc + m.qty : acc), 0)
        const invalidHalf =
          halfModifiers.some((m, i) => !halves[i] || !Number.isFinite(m.qty) || m.qty <= 0 || m.qty > sQty) ||
          distinctHalves.length > 1 ||
          totalHalfUnits > sQty
        if (invalidHalf) {
          const key = `half_meat:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (mezcla de carnes ambigua)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }
        // Una proteína suelta puede ser sustitución: conservar base provisional
        // y advertir, nunca reemplazar por orden alfabético o por una nota libre.
        for (const mod of mods.filter(m => {
          if (explicitExtraProteinModRx.test(m.norm) || halfProteinModRx.test(m.norm) || genericExtraMeatModRx.test(m.norm)) return false
          const exactProt = proteinPatterns.find(([pk]) => m.norm === pk || (pk === 'pollo' && m.norm === 'chicken'))?.[0]
          if (exactProt && exactProt !== base) return true
          return (
            /\b(?:no|sin|con|cambiar)\b/.test(m.norm) &&
            (Boolean(resolveProteinToken(m.norm)) || /\bcarne\b/.test(m.norm)) &&
            !/^poner este taco con el de\s/.test(m.norm)
          )
        })) {
          const key = `protein_substitution:${selectionKey}:${mod.norm}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (sustitución pendiente: ${mod.name})`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }

        if (!invalidHalf && distinctHalves.length === 1 && totalHalfUnits > 0) {
          const secondProt = distinctHalves[0]
          const halfShare = totalHalfUnits / sQty
          const totalBaseAndGenericOz = baseUnitOz * sQty + unitExtraOz * genericExtraUnits
          const splitPoolOz = totalBaseAndGenericOz * halfShare
          const unsplitOz = totalBaseAndGenericOz * (1 - halfShare)
          cookedMeatOz[base] += unsplitOz + splitPoolOz / 2
          cookedMeatOz[secondProt] += splitPoolOz / 2
        } else {
          cookedMeatOz[base] += baseUnitOz * sQty + unitExtraOz * genericExtraUnits
        }

        applyExplicitExtraProteinModifiers(unitExtraOz)
        return true
      }

      if (normName === 'empleado' && employeeHasCompanion) continue

      // Los separadores, notas abiertas y marcadores de descuento no son comida;
      // deben salir antes de cualquier receta para no contaminar uncoveredProducts.
      if (isNonFoodPosMarker(sel.guid, normName)) continue

      // El papelito es un preparado por platillo, NO el papel wax de envolver.
      // La tienda lo cuenta por piezas incluso cuando la caja de 60 está abierta.
      const isVegetarianModifier = mods.some(m => /vegetar|veggie|vegie/.test(m.norm))
      const isVegetarianSuperBurrito = /super\s+burrito\s+(?:vegetar|veggie|vegie)/.test(normName) ||
        (isSuperBurrito && isVegetarianModifier)
      if (isVegetarianSuperBurrito) {
        papelitoCount += 2 * sQty
      } else if ((!/\btaco\s*plate\b/.test(normName) && /torta|plato|plate/.test(normName)) ||
        (!/burrito/.test(normName) && (/vegetar|veggie|vegie/.test(normName) || isVegetarianModifier)) ||
        (!/burrito/.test(normName) && /huevos?|chilaquil|machaca|omelet/.test(normName))) {
        papelitoCount += sQty
      }
      // Toppings medidos para TODAS las tortas, incluidos los productos con
      // receta específica que continúan abajo. Evitar doble conteo de sus líneas DB.
      if (isTorta && keptMayoQty > 0) {
        mayonesaOz += fixedRecipeOz(itemMayonesa, 0.6) * keptMayoQty
      }
      // Auditoría QBO (Francisco Foods -> Kitchen-TEG -> Cocina -> 15 tiendas): el 95.5% de Queso Fresco
      // sigue facturado/incluido 1:1 dentro de 271W Papelito Para Torta aunque físicamente se empaque aparte.
      // NO descontar 1 pza de 029W en Tortas regulares (evita doble cobro); Torta Queso, Sope Queso y
      // Side Order Queso Fresco usan su receta DB y el modificador Extra Queso Fresco suma +1 pza sin duplicar.
      const extraQuesoFrescoUnits = sumModUnits(m =>
        m.guid === '819876d8-aaa8-4848-83f3-54d079bbb90d' ||
        /^extra\s+queso\s+fresco\b/.test(m.norm)
      )
      if (extraQuesoFrescoUnits > 0) {
        quesoFrescoCount += 1 * extraQuesoFrescoUnits
      }
      if ((isTorta || isSuperBurrito || isSuperQuesadilla || isNachos) && keptAvocadoQty > 0) {
        aguacateOz += fixedRecipeOz(itemAguacate, 2.3) * keptAvocadoQty
      }
      // Corrección de Carlos: las tortas NO llevan crema.
      if ((isSuperBurrito || isSuperQuesadilla || isNachos) && keptCremaQty > 0) {
        cremaOz += fixedRecipeOz(itemCrema, 1.5) * keptCremaQty
      }
      if ((isPlate || isBreakfast) && keptCotijaQty > 0) {
        quesoCotijaOz += fixedRecipeOz(itemQuesoCotija, 0.15) * keptCotijaQty
      }
      if (isSope) {
        if (keptCremaQty > 0) cremaOz += fixedRecipeOz(itemCrema, 0.75) * keptCremaQty
        if (keptCotijaQty > 0) quesoCotijaOz += fixedRecipeOz(itemQuesoCotija, 0.35) * keptCotijaQty
      }

      // Recetas específicas: antes estos productos caían en ramas genéricas que
      // omitían ingredientes. Papelito ya fue contabilizado en piezas arriba.
      // Meat Only Burrito y Meat Only Super Burrito se procesan en la rama 6 (BURRITOS)
      // con 12 oz base (+6 oz Extra, soporte Half 50/50) y sin arroz/frijol.
      if (/huevos?/.test(normName) ||
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

        const removedUnitsByItemId = new Map<string, number>()
        if (itemAguacate && removedAvocado > 0) removedUnitsByItemId.set(itemAguacate.id, removedAvocado)
        if (itemCrema && removedCrema > 0) removedUnitsByItemId.set(itemCrema.id, removedCrema)
        if (itemMayonesa && removedMayo > 0) removedUnitsByItemId.set(itemMayonesa.id, removedMayo)
        if (itemQuesoRayado && removedJack > 0) removedUnitsByItemId.set(itemQuesoRayado.id, removedJack)
        if (itemQuesoFresco && removedQuesoFresco > 0) removedUnitsByItemId.set(itemQuesoFresco.id, removedQuesoFresco)
        if (itemArroz && removedRice > 0) removedUnitsByItemId.set(itemArroz.id, removedRice)
        if (itemFrijolMolido && removedBeans > 0) removedUnitsByItemId.set(itemFrijolMolido.id, removedBeans)
        if (itemQuesoCotija && removedCotija > 0) removedUnitsByItemId.set(itemQuesoCotija.id, removedCotija)

        const handledSpecificModRxs: RegExp[] = [
          /^(?:no|sin)\s+(?:rice|arroz|beans?|frijol(?:es)?|sour\s*cream|crema|jack|cheese|queso(?:\s+fresco)?|cotija(?:\s+cheese)?|guacamole|aguacate|avocado|mayo|mayonesa|tortillas?|tomato|tomate|lettuce|lechuga|verdura|cebolla|cilantro|yolk|partir)(?:\s*\(in store\))?$/,
          /^poco\s+(?:arroz|frijol)$/,
          /^(?:1\s*tortilla(?:\s*\(in store\))?|(?:half|mitad)\s+(?:flour\/corn|corn\/flour)|(?:corn|flour)(?:\s+tortillas?)?|maiz|harina|tortillas?\s+(?:maiz|harina))$/,
          /^(?:empleado|policia|bolsa\s+apa(?:rte|dte)|well done|over easy|medium well|sunny side up|scrambled|medium|easy|hard|partido en dos|poner en el grill|tortilla dorada|tortilla no grasa(?:\s*\(in store\))?)$/,
          /^(?:salsa\s+(?:verde|roja|aparte)|onions?\s*&\s*cilantro|limes?|pickled\s+jalapenos?|con\s+(?:cebolla|cilantro|roja|verde|lechuga)(?:\s*\(in store\))?|preparados|(?:aguacate|crema)\s+aparte(?:\s*\(in store\))?)$/,
          /^(?:(?:extra\s+)?jack\s+cheese\b.*|(?:extra\s+)?(?:cheese|queso)\b.*|(?:extra\s+)?guacamole\b.*|(?:extra\s+)?(?:aguacate|avocado)\b.*|(?:extra\s+)?(?:sour\s*cream|crema)\b.*|(?:extra\s+)?nacho\s+cheese\b.*)$/,
        ]
        for (const mod of mods) {
          if (
            handledSpecificModRxs.some(rx => rx.test(mod.norm)) ||
            genericExtraMeatModRx.test(mod.norm) ||
            explicitExtraProteinModRx.test(mod.norm) ||
            halfProteinModRx.test(mod.norm)
          ) {
            continue
          }
          flag(`modificador pendiente: ${mod.name}`)
        }

        const isTacoSpecific = /^taco\s/.test(normName)
        const isSmallPortionSpecific = isTacoSpecific || isSope
        const specificExtraMeatUnits = sumModUnits(m => genericExtraMeatModRx.test(m.norm))
        const specificExtraUnitOz = isSmallPortionSpecific ? 1.5 : 6.0
        const specificHalfMods = mods.filter(m => /^(?:half|mitad)\s+/.test(m.norm))
        const specificHalfProts = specificHalfMods
          .map(m => (halfProteinModRx.test(m.norm) ? resolveProteinToken(m.norm) : undefined))
          .filter((p): p is ActiveProteinKey => !!p)
        const specificTotalHalfUnits = specificHalfMods.reduce(
          (acc, m) => (halfProteinModRx.test(m.norm) && Number.isFinite(m.qty) && m.qty > 0 ? acc + m.qty : acc),
          0
        )

        let hadBaseAvocadoInRecipe = isTorta || isSuperBurrito || isSuperQuesadilla || isNachos
        let hadBaseCremaInRecipe = isSuperBurrito || isSuperQuesadilla || isNachos || isSope
        let hadBaseJackInRecipe = isSuperBurrito

        for (const row of lines) {
          if (row.inventory_item_id === itemPapelitoTorta?.id) continue
          if (row.inventory_item_id === itemAguacate?.id) hadBaseAvocadoInRecipe = true
          if (row.inventory_item_id === itemCrema?.id) hadBaseCremaInRecipe = true
          if (row.inventory_item_id === itemQuesoRayado?.id) hadBaseJackInRecipe = true

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
          const effectiveUnits = Math.max(0, sQty - (removedUnitsByItemId.get(item.id) || 0))
          if (effectiveUnits <= 0) continue

          const protein = Object.keys(itemMeats).find(p => itemMeats[p]?.id === item.id) as ActiveProteinKey | undefined
          if (protein) {
            const ounces = unit === 'oz' ? amount : unit === 'lb' ? amount * 16 : NaN
            if (!Number.isFinite(ounces)) { flag(`unidad de carne incompatible: ${item.name}`); continue }
            const yieldFactor = MEAT_COOKING_YIELDS[protein]
            const cookedPerUnit = ounces * (row.type === 'raw' ? yieldFactor : 1)
            const totalCookedPool = cookedPerUnit * effectiveUnits + specificExtraUnitOz * specificExtraMeatUnits
            const secondProt = specificHalfProts.find(p => p !== protein)
            if (secondProt && specificHalfProts.length === 1 && specificTotalHalfUnits > 0 && specificTotalHalfUnits <= effectiveUnits) {
              const halfShare = specificTotalHalfUnits / effectiveUnits
              const splitPool = totalCookedPool * halfShare
              const unsplitPool = totalCookedPool * (1 - halfShare)
              cookedMeatOz[protein] += unsplitPool + splitPool / 2
              cookedMeatOz[secondProt] += splitPool / 2
            } else {
              cookedMeatOz[protein] += totalCookedPool
            }
            continue
          }

          if (isTacoSpecific && item.id === itemCornTortillas?.id) {
            const oneTortUnits = sumModUnits(m => /^1\s*tortilla\b/.test(m.norm))
            const totalTortillas = 2 * Math.max(0, effectiveUnits - oneTortUnits) + 1 * oneTortUnits
            generalItemUsage.set(item.id, (generalItemUsage.get(item.id) || 0) + totalTortillas)
            continue
          }

          let base = convertRecipeAmountToCatalogMeasure(amount, row.unit, item)
          if (/^huevos?\s*rancheros?$/.test(normName) && item.id === itemSalsaRanchera?.id) {
            base = measure === 'lb' ? 4 / 16 : measure === 'oz' ? 4 : base
          }
          if (!Number.isFinite(base)) { flag(`unidad incompatible: ${item.name}`); continue }
          generalItemUsage.set(item.id, (generalItemUsage.get(item.id) || 0) + base * effectiveUnits)
        }

        // Modificadores aditivos de proteína ("Extra <Proteína>"), queso, aguacate, crema y nacho cheese en recetas específicas / desayunos
        applyExplicitExtraProteinModifiers(specificExtraUnitOz)
        applyExtraNachoCheeseModifiers()

        if (isSuperBurrito && keptJackQty > 0) {
          quesoRayadoOz += fixedRecipeOz(itemQuesoRayado, 2.1) * keptJackQty
        }
        if (!noJack) {
          const jackAddUnits = sumModUnits(isJackCheeseAddMod)
          if (jackAddUnits > 0) {
            quesoRayadoOz += (isSmallPortionSpecific ? 0.6 : 2.1) * jackAddUnits
          }
        }
        if (!noAvocado) {
          const guacAddUnits = sumModUnits(m =>
            !/\baparte\b|^no\b|^sin\b/.test(m.norm) &&
            (hadBaseAvocadoInRecipe
              ? /^extra\s+(?:guacamole|aguacate|avocado)\b/.test(m.norm)
              : /^(?:extra\s+)?(?:guacamole|aguacate|avocado)\b/.test(m.norm))
          )
          if (guacAddUnits > 0) {
            aguacateOz += (isSmallPortionSpecific ? 1.0 : hadBaseAvocadoInRecipe ? 2.0 : 2.3) * guacAddUnits
          }
        }
        if (keptCremaQty > 0) {
          const cremaAddUnits = sumModUnits(m =>
            !/\baparte\b|^no\b|^sin\b/.test(m.norm) &&
            (hadBaseCremaInRecipe
              ? /^extra\s+(?:sour\s*cream|crema)\b/.test(m.norm)
              : /^(?:extra\s+)?(?:sour\s*cream|crema)\b/.test(m.norm))
          )
          if (cremaAddUnits > 0) {
            cremaOz += (isSmallPortionSpecific ? 0.45 : 1.5) * cremaAddUnits
          }
        }

        if (/^huevos?\b/.test(normName) || normName === 'plato jamon') {
          const halfCornFlour = sumModUnits(m => /^(?:half|mitad)\b/.test(m.norm) && /corn|maiz/.test(m.norm) && /harina|flour/.test(m.norm))
          const noTortillasUnits = sumModUnits(m => /^(?:no|sin)\s+tortillas?\b/.test(m.norm))
          const cornUnits = sumModUnits(m => !/^(?:half|mitad|no|sin)\b/.test(m.norm) && /corn|maiz/.test(m.norm))
          const flourUnits = sumModUnits(m => !/^(?:half|mitad|no|sin)\b/.test(m.norm) && /harina|flour/.test(m.norm))
          if (halfCornFlour + noTortillasUnits + cornUnits + flourUnits > sQty && cornUnits > 0 && flourUnits > 0 && sQty === 1) {
            flag('elección de tortilla contradictoria')
          } else if (halfCornFlour > 0 || cornUnits > 0 || flourUnits > 0 || noTortillasUnits > 0) {
            cornTortillaCount += 4 * halfCornFlour + 8 * cornUnits
            regular8TortillaCount += 1 * halfCornFlour + 2 * flourUnits
            const unaccounted = sQty - (halfCornFlour + noTortillasUnits + cornUnits + flourUnits)
            if (unaccounted > 0) flag('tortilla de desayuno no registrada')
          } else {
            flag('tortilla de desayuno no registrada')
          }
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
        const split = hasCorn && hasFlour

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

        const meatWeights = new Map<string, number>()
        const addMeatWeight = (k: string, w: number) => meatWeights.set(k, (meatWeights.get(k) || 0) + w)
        for (const m of mods) {
          const w = Number.isFinite(m.qty) && m.qty > 0 ? m.qty : 1
          if (/asada/.test(m.norm)) addMeatWeight('asada', w)
          if (/pollo|chicken/.test(m.norm)) addMeatWeight('pollo', w)
          if (/pastor/.test(m.norm)) addMeatWeight('pastor', w)
          if (/carnitas/.test(m.norm)) addMeatWeight('carnitas', w)
          if (/cabeza/.test(m.norm)) addMeatWeight('cabeza', w)
          if (/lengua/.test(m.norm)) addMeatWeight('lengua', w)
          if (/buche/.test(m.norm)) addMeatWeight('buche', w)
          if (/chorizo/.test(m.norm)) addMeatWeight('chorizo', w)
        }
        if (meatWeights.size === 0) {
          if (/asada/.test(fullText)) addMeatWeight('asada', 1)
          if (/pollo|chicken/.test(fullText)) addMeatWeight('pollo', 1)
          if (/pastor/.test(fullText)) addMeatWeight('pastor', 1)
          if (/carnitas/.test(fullText)) addMeatWeight('carnitas', 1)
          if (/cabeza/.test(fullText)) addMeatWeight('cabeza', 1)
          if (/lengua/.test(fullText)) addMeatWeight('lengua', 1)
          if (/buche/.test(fullText)) addMeatWeight('buche', 1)
          if (/chorizo/.test(fullText)) addMeatWeight('chorizo', 1)
        }
        if (meatWeights.size > 0) {
          const totalMeatW = Array.from(meatWeights.values()).reduce((a, b) => a + b, 0)
          const totalMeatOz = pt.meatLbs * 16 * sQty
          for (const [p, w] of meatWeights.entries()) {
            cookedMeatOz[p] = (cookedMeatOz[p] || 0) + totalMeatOz * (w / totalMeatW)
          }
        } else {
          const key = `party_meat:${selectionKey}`
          const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (carne no registrada)`, qty: 0 }
          prior.qty += sQty
          uncoveredMap.set(key, prior)
        }

        const aguaWeights = new Map<string, number>()
        const addAguaWeight = (k: string, w: number) => aguaWeights.set(k, (aguaWeights.get(k) || 0) + w)
        for (const m of mods) {
          const w = Number.isFinite(m.qty) && m.qty > 0 ? m.qty : 1
          if (/horchata/.test(m.norm)) addAguaWeight('horchata', w)
          if (/jamaica/.test(m.norm)) addAguaWeight('jamaica', w)
          if (/tamarindo/.test(m.norm)) addAguaWeight('tamarindo', w)
          if (/pina|piña/.test(m.norm)) addAguaWeight('pina', w)
        }
        if (aguaWeights.size === 0) {
          if (/horchata/.test(fullText)) addAguaWeight('horchata', 1)
          if (/jamaica/.test(fullText)) addAguaWeight('jamaica', 1)
          if (/tamarindo/.test(fullText)) addAguaWeight('tamarindo', 1)
          if (/pina|piña/.test(fullText)) addAguaWeight('pina', 1)
        }
        if (aguaWeights.size > 0) {
          const totalAguaW = Array.from(aguaWeights.values()).reduce((a, b) => a + b, 0)
          const totalAguaGal = pt.aguaGallons * sQty
          for (const [a, w] of aguaWeights.entries()) {
            aguaGallons[a] = (aguaGallons[a] || 0) + totalAguaGal * (w / totalAguaW)
          }
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
        if (keptRiceQty > 0) arrozOz += 4 * keptRiceQty
        if (keptBeansQty > 0) frijolMolidoOz += 4 * keptBeansQty
        applyExtraNachoCheeseModifiers()
        // El modificador Jack Cheese corresponde a tacos concretos del plato;
        // Toast registra su cantidad, no implica queso para los tres tacos.
        if (!noJack) {
          quesoRayadoOz += 0.6 * mods.filter(m => /^jack\s+cheese\b/.test(m.norm))
            .reduce((sum, m) => sum + (Number.isFinite(m.qty) && m.qty > 0 ? m.qty : 0), 0)
        }

        const hasPlateExtraMeat = mods.some(m => /^(?:extra|doble|double)\s*(?:carne|meat)/.test(m.norm))
        const hasPlateDorada = mods.some(m => /\bcarne\s*dorada\b/.test(m.norm))
        const ozPerPlateTaco = 1.5 + (hasPlateExtraMeat ? 1.5 : 0) + (hasPlateDorada ? 0.4 : 0)

        const tacoChoices = mods.filter(m => /taco\s+(asada|pastor|pollo|cabeza|lengua|chorizo|carnitas|buche|vegetar|veggie|vegie|tripa)/.test(m.norm))
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
                if (tm.norm.includes(prot)) cookedMeatOz[prot] = (cookedMeatOz[prot] || 0) + ozPerPlateTaco * tm.qty * modifierFactor
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
        const oneTortUnits = sumModUnits(m => /1\s*tortilla/.test(m.norm))
        cornTortillaCount += 2 * Math.max(0, sQty - oneTortUnits) + 1 * oneTortUnits

        const doradaUnits = sumModUnits(m => /\bcarne\s*dorada\b/.test(m.norm))
        const tacoBaseOz = 1.5 + (doradaUnits > 0 ? 0.4 * (doradaUnits / sQty) : 0)

        const meatFound = applyNamedMeatPortion(tacoBaseOz, 1.5)
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
        if (!noJack) {
          const jackUnits = sumModUnits(isJackCheeseAddMod)
          if (jackUnits > 0) quesoRayadoOz += 0.6 * jackUnits
        }
        applyExtraNachoCheeseModifiers()
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
        let matchedPlateAvocado = false
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
            matchedPlateAvocado = true
            if (keptAvocadoQty > 0) aguacateOz += ounces * keptAvocadoQty
          }
        }
        // Confirmado por Carlos: todos los Platos regulares llevan 2.0 oz de Bolsa Aguacate aun si la tienda tiene GUID local distinto
        if (!matchedPlateAvocado && /^plato\s+/.test(normName) && keptAvocadoQty > 0) {
          aguacateOz += 2.0 * keptAvocadoQty
        }
        const halfCornFlourUnits = sumModUnits(m => /^(?:half|mitad)\b/.test(m.norm) &&
          /corn|maiz/.test(m.norm) && /harina|flour/.test(m.norm))
        const cornUnits = sumModUnits(m => !/^(?:half|mitad|no|sin)\b/.test(m.norm) && /corn|maiz/.test(m.norm))
        const flourUnits = sumModUnits(m => !/^(?:half|mitad|no|sin)\b/.test(m.norm) && /harina|flour/.test(m.norm))
        if (halfCornFlourUnits > 0 || cornUnits > 0 || flourUnits > 0) {
          cornTortillaCount += 4 * halfCornFlourUnits + 8 * cornUnits
          regular8TortillaCount += 1 * halfCornFlourUnits + 2 * flourUnits
        }

        if (/huevos?/.test(normName)) huevoCount += 2 * sQty
        if (/huevos?\s*rancheros?/.test(normName)) salsaRancheraOz += 4 * sQty
        if (/milanesa|milaneza/.test(normName)) milanesaPieceCount += 3 * sQty

        if (keptRiceQty > 0) arrozOz += 4 * keptRiceQty
        if (keptBeansQty > 0) frijolMolidoOz += 4 * keptBeansQty
        if (!noJack) {
          const jackUnits = sumModUnits(isJackCheeseAddMod)
          if (jackUnits > 0) quesoRayadoOz += 2.1 * jackUnits
        }
        applyExtraNachoCheeseModifiers()

        if (!applyNamedMeatPortion(6, 6)) {
          applyExplicitExtraProteinModifiers(6)
        }
        continue
      }

      // 6. BURRITOS (incluye Meat Only Burrito y Meat Only Super Burrito con 12 oz base)
      if (/burrito/.test(normName)) {
        burritoTortillaCount += 1 * sQty
        const isMeatOnly = /^meat\s*only\b/.test(normName)
        const baseBurritoMeatOz = isMeatOnly ? 12.0 : 6.0

        // Un solo Half es la forma habitual de Toast: mitad carne del nombre,
        // mitad proteína elegida. La función también valida cantidades y mezclas.
        const found = applyNamedMeatPortion(baseBurritoMeatOz, 6.0)
        if (!found) {
          applyExplicitExtraProteinModifiers(6.0)
          if (!/bean|cheese|veggie|vegie|vegetar/.test(normName)) {
            const key = `burrito_meat:${selectionKey}`
            const prior = uncoveredMap.get(key) || { guid: sel.guid || 'NO_GUID', name: `${sName} (carne no registrada)`, qty: 0 }
            prior.qty += sQty
            uncoveredMap.set(key, prior)
          }
        }

        // Unificado con public.recipes confirmado por Carlos:
        // Burrito Beans & Cheese (sin arroz ni carne) lleva doble porción de frijol (8.0 oz);
        // el resto de burritos con frijol (incl. Beans/Cheese/Rice y regulares) llevan 4.0 oz arroz y 4.0 oz frijol.
        const isBeansCheeseOnly =
          /^burrito\s+beans?\s*(?:\/|&|and|y)\s*cheese$/.test(normName) ||
          normName === 'burrito beans/cheese'
        const isBeansCheeseRice =
          /^burrito\s+(?:beans?\s*(?:\/|&)\s*cheese\s*(?:\/|&)\s*rice|beans?\s*(?:\/|&)\s*rice\s*(?:\/|&)\s*cheese)$/.test(normName) ||
          normName === 'burrito beans/cheese/rice'
        if (!isMeatOnly) {
          if (!isBeansCheeseOnly && keptRiceQty > 0) arrozOz += 4 * keptRiceQty
          if (keptBeansQty > 0) frijolMolidoOz += (isBeansCheeseOnly ? 8 : 4) * keptBeansQty
        }

        // Jack pesado: 5.0 oz en Burrito Beans/Cheese, 4.0 oz en Burrito Beans/Cheese/Rice, 2.1 oz en Super Burrito;
        // más +2.1 oz cuando piden modificador Jack Cheese / Extra Cheese (en burrito regular o como extra sobre Super Burrito).
        const isInherentJackBurrito = /super|cheese|queso/.test(normName)
        if (isInherentJackBurrito && keptJackQty > 0) {
          const cheesePerBurrito = isBeansCheeseOnly
            ? 5.0
            : isBeansCheeseRice
              ? 4.0
              : isSuperBurrito
                ? fixedRecipeOz(itemQuesoRayado, 2.1)
                : 2.1
          quesoRayadoOz += cheesePerBurrito * keptJackQty
        }
        if (!noJack) {
          const jackModUnits = isInherentJackBurrito
            ? sumModUnits(isJackCheeseAddMod)
            : sumModUnits(m => !/nacho|fresco|cotija|aparte|on\s+the\s+side|on\s+the\s+chips|poco/.test(m.norm) && !/^(?:no|sin)\b/.test(m.norm) && /cheese|queso/.test(m.norm))
          if (jackModUnits > 0) quesoRayadoOz += 2.1 * jackModUnits
        }
        applyExtraNachoCheeseModifiers()

        // Dos disparos de aguacate y tres de crema, medidos por peso (cuando se agregan como modificador a burrito regular).
        if (!isSuperBurrito && !noAvocado) {
          const avoModUnits = sumModUnits(m => !/\baparte\b|^no\b|^sin\b/.test(m.norm) && /aguacate|avocado|guac/.test(m.norm))
          if (avoModUnits > 0) aguacateOz += 2.3 * avoModUnits
        }
        if (!isSuperBurrito && keptCremaQty > 0) {
          const cremaModUnits = sumModUnits(m => !/\baparte\b|^no\b|^sin\b/.test(m.norm) && /crema|sour\s*cream/.test(m.norm))
          if (cremaModUnits > 0) cremaOz += 1.5 * cremaModUnits
        }
        continue
      }

      // 7. MULITAS Y SUPER MULITAS
      if (/mulita/.test(normName)) {
        mulitasPairCount += 1 * sQty
        if (/super/.test(normName)) {
          if (keptAvocadoQty > 0) aguacateOz += fixedRecipeOz(itemAguacate, 1.15) * keptAvocadoQty
          if (keptCremaQty > 0) cremaOz += fixedRecipeOz(itemCrema, 0.75) * keptCremaQty
        }
        if (/\bjamon\b/.test(normName)) jamonOz += 1.4 * sQty
        if (!applyNamedMeatPortion(1.5, 1.5)) {
          applyExplicitExtraProteinModifiers(1.5)
        }
        if (!noJack) {
          const jackModUnits = sumModUnits(isJackCheeseAddMod)
          if (jackModUnits > 0) quesoRayadoOz += 0.6 * jackModUnits
        }
        applyExtraNachoCheeseModifiers()
        continue
      }

      // 8. TORTAS (toppings medidos arriba, también para recetas específicas)
      if (/torta/.test(normName)) {
        teleraCount += 1 * sQty
        if (/milanesa|milaneza/.test(normName)) milanesaPieceCount += 2 * sQty
        if (/^torta\s+jamon$/.test(normName)) jamonOz += 3 * 1.4 * sQty
        if (/^torta\s+cubana$/.test(normName)) {
          const keptMilanesaQty = Math.max(0, sQty - countRemovedUnits(/^(?:no|sin)\s+milane[sz]a\b/))
          const keptJamonQty = Math.max(0, sQty - countRemovedUnits(/^(?:no|sin)\s+jamon\b/))
          const keptSalchichaQty = Math.max(0, sQty - countRemovedUnits(/^(?:no|sin)\s+salchicha\b/))
          milanesaPieceCount += keptMilanesaQty
          jamonOz += 1.4 * keptJamonQty
          salchichaOz += 0.8 * keptSalchichaQty
        }
        if (!applyNamedMeatPortion(6.0, 6.0)) {
          applyExplicitExtraProteinModifiers(6.0)
        }
        if (keptBeansQty > 0) frijolMolidoOz += 1.5 * keptBeansQty
        applyExtraNachoCheeseModifiers()
        continue
      }

      // 9. SOPES (un disparo de crema y una cucharada de cotija)
      if (/sope/.test(normName)) {
        sopeCount += 1 * sQty
        if (!applyNamedMeatPortion(1.5, 1.5)) {
          applyExplicitExtraProteinModifiers(1.5)
        }
        if (keptBeansQty > 0) frijolMolidoOz += 1.5 * keptBeansQty
        if (!noJack) {
          const jackModUnits = sumModUnits(isJackCheeseAddMod)
          if (jackModUnits > 0) quesoRayadoOz += 0.6 * jackModUnits
        }
        applyExtraNachoCheeseModifiers()
        continue
      }

      // 10. QUESADILLAS (Quesadilla Bodega es un paquete preformado de 12 ct que ya incluye queso)
      if (/quesadilla/.test(normName)) {
        quesadillaBodegaCount += 1 * sQty
        if (!applyNamedMeatPortion(6.0, 6.0)) {
          applyExplicitExtraProteinModifiers(6.0)
        }
        if (!noJack) {
          const jackModUnits = sumModUnits(isJackCheeseAddMod)
          if (jackModUnits > 0) quesoRayadoOz += 2.1 * jackModUnits
        }
        applyExtraNachoCheeseModifiers()
        // Los toppings de la Super Quesadilla ya se agregaron antes de las recetas específicas.
        continue
      }

      // 11. NACHOS (Confirmado por Carlos: Super Nachos lleva 5.0 oz Queso Amarillo líquido, 0 oz Frijol Molido, Aguacate y Crema + extras opcionales)
      if (isNachos) {
        nachoChipBags += 1 * sQty
        quesoAmarilloOz += 5 * sQty
        if (!noJack) {
          const jackModUnits = sumModUnits(isJackCheeseAddMod)
          if (jackModUnits > 0) quesoRayadoOz += 2.1 * jackModUnits
        }
        applyExtraNachoCheeseModifiers()
        if (!applyNamedMeatPortion(6.0, 6.0)) {
          applyExplicitExtraProteinModifiers(6.0)
        }
        continue
      }

      // 12. SIDES DE ARROZ Y FRIJOL (Confirmado por Carlos: Side Rice = 6 oz en vaso 8 oz; Side Beans = 8 oz Frijol Molido; Frijol de la olla = 4 oz en vaso 4 oz)
      if (/^rice$/.test(normName) || /^side\s*(?:order\s*)?rice$/.test(normName)) {
        arrozOz += 6 * sQty
        continue
      }
      if (/^side\s*order\s*beans\/rice$/.test(normName)) {
        arrozOz += 4 * sQty
        frijolMolidoOz += 4 * sQty
        continue
      }
      if (/^beans$/.test(normName) || /^side\s*(?:order\s*)?beans$/.test(normName) || /^whole\s*beans$/.test(normName)) {
        if (
          sel.guid === '2a9dd8f4-3365-4f87-abf1-e8eb39296f98' ||
          sel.guid === 'c09a1208-e42f-4ee3-aa64-f1fab2668b58' ||
          /^whole\s*beans$/.test(normName)
        ) {
          frijolEnteroOz += 4 * sQty
        } else {
          frijolMolidoOz += 8 * sQty
        }
        continue
      }
      if (/frijol\s*d\/?l\/?o/.test(normName)) {
        frijolEnteroOz += 4 * sQty
        continue
      }

      const proteinIdToKey = new Map<string, ActiveProteinKey>(
        (Object.entries(ACTIVE_PROTEIN_IDS) as Array<[ActiveProteinKey, string]>).map(([k, id]) => [id, k])
      )
      const combinedSelectionLabel = mods.length > 0 && !sName.includes('(')
        ? `${sName} (${mods.map(m => m.name).join(', ')})`
        : sName

      // 12b. BOTONES DE 1 LB DE PROTEÍNA DIRECTA ("Asada", "Pastor", "Pollo", "Cabeza", "Lengua", "Buche", "Carnitas", "Chorizo")
      if (/^(asada|pastor|pollo|cabeza|lengua|buche|carnitas|chorizo)$/.test(normName)) {
        cookedMeatOz[normName] = (cookedMeatOz[normName] || 0) + 16 * sQty
        continue
      }

      // 13. CARNE POR LIBRA (Catering: 2 lb, 6 lb, 12 lb Meat)
      const lbMatch = normName.match(/\b(\d+)\s*lb\s*meat\b/)
      if (lbMatch) {
        const lbs = parseInt(lbMatch[1], 10)
        const alloc = parseProteinAllocation(combinedSelectionLabel, [
          { inventory_item_id: ACTIVE_PROTEIN_IDS.asada, quantity: lbs * 16, unit: 'oz' },
        ])
        if (alloc && alloc.portionsOz.size > 0) {
          for (const [pId, oz] of alloc.portionsOz.entries()) {
            const pk = proteinIdToKey.get(pId)
            if (pk) cookedMeatOz[pk] = (cookedMeatOz[pk] || 0) + oz * sQty
          }
        } else {
          // Confirmado por Carlos: cuando no especifican carne, descontar provisionalmente de Carne Asada
          cookedMeatOz.asada = (cookedMeatOz.asada || 0) + lbs * 16 * sQty
        }
        continue
      }

      // 14. SIDE ORDER CARNE (6.0 oz cocidas; Milanesa = 3 piezas; sin especificar = Carne Asada)
      if (/side\s*(?:order\s*)?carne/.test(normName)) {
        const nonGrillKind = detectNonGrillSideProteinKind(combinedSelectionLabel)
        if (nonGrillKind === 'milanesa') {
          milanesaPieceCount += 3 * sQty
          continue
        }
        if (nonGrillKind === 'salchicha') {
          salchichaOz += 2.3 * sQty
          continue
        }
        if (nonGrillKind === 'jamon') {
          jamonOz += 4.2 * sQty
          continue
        }
        const alloc = parseProteinAllocation(combinedSelectionLabel, [])
        if (alloc && alloc.portionsOz.size > 0) {
          for (const [pId, oz] of alloc.portionsOz.entries()) {
            const pk = proteinIdToKey.get(pId)
            if (pk) cookedMeatOz[pk] = (cookedMeatOz[pk] || 0) + oz * sQty
          }
        } else {
          cookedMeatOz.asada = (cookedMeatOz.asada || 0) + 6.0 * sQty
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
        const isBulkChampurrado = /olla|to-?go\s*box|96\s*oz/.test(normName)
        aguaGallons.champurrado += (isBulkChampurrado ? 0.3 : 0.05) * sQty // 38.4 oz olla/box (0.30 gal) vs 6.4 oz vaso (0.05 gal)
        continue
      }

      // 16. POSTRES
      if (/cheesecake/.test(normName) && !/whole|full/.test(normName)) {
        cheesecakeCount += 1 * sQty
        continue
      }
      if (/flan/.test(normName) && !/whole|full/.test(normName)) {
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

          const rawAmount = (Number(r.quantity) || 0) * sQty
          const targetItem = invMap.get(r.inventory_item_id)
          const converted = convertRecipeAmountToCatalogMeasure(rawAmount, r.unit, targetItem)
          const totalUnits = Number.isFinite(converted) ? converted : rawAmount
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
  // Salsa Huevos Rancheros es físicamente bolsa de 2.30 lb (quantity_per_unit legado en DB = 0.5).
  registerUsage(itemSalsaRanchera, (salsaRancheraOz / 16) / 2.3, 'bolsas_salsa_ranchera_2_3_lb')
  registerUsage(itemQuesoRayado, (quesoRayadoOz / 16) / 2, 'bolsas_2_lb')
  if (quesoFrescoCount > 0) {
    registerUsage(itemQuesoFresco, quesoFrescoCount / Number(itemQuesoFresco?.quantity_per_unit || 20), 'paquetes_queso_fresco_20_pza')
  }
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
  registerUsage(itemJalapenoBulk, (jalapenoBulkOz / 16) / 6.5625, 'bolsas_rajas_6_5625_lb')
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
    // La unidad del conteo operativo puede diferir del empaque legado del catálogo.
    // Aplicar exactamente el mismo contrato físico que en las ramas específicas de arriba.
    const perUnit =
      item.id === itemPapelitoTorta?.id ? 1 :
      item.id === itemAmarilloCheese?.id ? 440 :
      item.id === itemSalsaRanchera?.id ? 2.3 :
      item.id === itemAguacate?.id ? 2 :
      item.id === itemMeats.pastor?.id ? (meatBagSizes.pastor || 5) :
      item.id === itemMeats.pollo?.id ? (meatBagSizes.pollo || 5) :
      item.id === itemMeats.cabeza?.id ? (meatBagSizes.cabeza || 2.5) :
      item.id === itemMeats.lengua?.id ? (meatBagSizes.lengua || 2.5) :
      Number(item.quantity_per_unit || 1)
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

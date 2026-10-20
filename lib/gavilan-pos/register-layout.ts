/**
 * @module lib/gavilan-pos/register-layout
 * @description Configuración y lógica pura (client + server safe) de la pantalla de Caja de Gavilan POS.
 *              Define familias (pestañas), orden fijo de proteínas, matriz Proteína × Familia,
 *              grupos obligatorios (required modifiers), descuentos autorizados y utilidades del ticket
 *              (precio por línea, validación de obligatorios, agrupación por Plato/Bolsa, etiquetas de cocina).
 *
 * @businessRules
 * - **Basado en datos reales**: El orden de pestañas sale de 13.48M unidades vendidas en caja
 *   (For Here / To Go / Drive Thru / Phone) en `pmix_daily_cache` (349 días × 15 tiendas, validado 1:1 contra tickets).
 * - **Orden fijo de proteínas (muscle memory)**: Asada → Pastor → Pollo → Cabeza → Lengua → Carnitas → Buche → Chorizo,
 *   igual en TODAS las pestañas (los POS QSR — Simphony / NP6 — no mueven botones de posición).
 * - **Ocultos**: 12 variantes de Tripa con 0 ventas en 349 días, `Test Item` (prueba de POS, no comida),
 *   14 separadores (reemplazados por la acción "Separar plato/bolsa") y `Empleado`/`Policia`
 *   (reemplazados por descuento autorizado con PIN de gerente).
 * - **"Más…"**: botones con < 0.15 unidades/día en toda la cadena (ej. Taco Tripa, Plato Jamón, Full Flan).
 * - **Obligatorios**: Tortilla en Platos y Huevos (default Maíz 72.7%), Queso en Super Nachos (default "on the chips" 96.5%),
 *   estilo de huevo (Huevos Rancheros / Egg, sin default), 3 tacos en Taco Plate, 2 carnes + aguas (3/4/5/6 según tamaño) + 1 tortilla
 *   en Party Trays, 1 carne por libra en "2/6/12 lb Meat".
 * - **Descuentos**: `EMPLEADO` = 50% (regla documentada en `lib/inventory/daily-order-consumption-engine.ts` 2026-09-28).
 *   `POLICIA` = el gerente elige 50% o 100% al autorizar (pendiente de confirmación de política por Carlos).
 * - **Drive-Thru Condiments**: solo visibles en modo DRIVE-THRU (99.8% de su uso es Drive-Thru).
 *
 * @dataFlow
 * - `GET /api/gavilan-pos/register-catalog` → items reales (`toast_menu_items` In Store) + modificadores
 *   (`gavilan_pos_register_modifiers`) → `CashierRegister` usa estas utilidades para armar el ticket.
 * - El ticket (`RegisterCartLine[]`) se cobra con el flujo existente de `app/gavilan-pos/page.tsx` (`CREATE_ORDER`).
 *
 * @notes
 * - Archivo sin dependencias de Node.js para poder usarse en Client Components.
 * - Comparaciones de texto insensibles a acentos/mayúsculas (`normalizeText`), ej. "Piña" vs "Pina".
 */

export type PrepStation = 'PARRILLA' | 'LINEA' | 'TORTILLAS' | 'BEBIDAS' | 'NONE'
export type DiningMode = 'FOR HERE' | 'TO GO' | 'DRIVE-THRU'

export type RegisterFamilyKey =
    | 'tacos' | 'bebidas' | 'burritos' | 'tortas' | 'super_burritos' | 'sopes' | 'mulitas' | 'quesadillas'
    | 'sides' | 'super_mulitas' | 'super_quesadillas' | 'platos' | 'super_nachos' | 'postres' | 'desayunos'
    | 'combos' | 'pura_carne' | 'catering' | 'dt_condiments'

export interface RegisterFamily {
    key: RegisterFamilyKey
    /** i18n key under gavilan_pos.register.families */
    labelKey: string
    /** Toast group names (after "In Store Menu > " / "In Store Drinks > ", without "(In Store)"), lowercase */
    toastGroups: string[]
    prepStation: PrepStation
    /** Tailwind classes (light mode, WCAG contrast with dark text) */
    tile: string
    accent: string
    driveThruOnly?: boolean
    /** Units sold by cashiers in 349 days (for documentation / ordering) */
    units349d: number
}

/** Ordered by real cashier volume (pmix_daily_cache, 349 days × 15 stores). */
export const REGISTER_FAMILIES: RegisterFamily[] = [
    { key: 'tacos', labelKey: 'tacos', toastGroups: ['tacos'], prepStation: 'PARRILLA', tile: 'bg-red-50 border-red-200', accent: 'bg-red-600', units349d: 6505698 },
    { key: 'bebidas', labelKey: 'bebidas', toastGroups: ['lg. fountain drinks', 'md. fountain drinks', 'misc. drinks'], prepStation: 'BEBIDAS', tile: 'bg-sky-50 border-sky-200', accent: 'bg-sky-600', units349d: 2539658 },
    { key: 'burritos', labelKey: 'burritos', toastGroups: ['burritos'], prepStation: 'LINEA', tile: 'bg-emerald-50 border-emerald-200', accent: 'bg-emerald-600', units349d: 933979 },
    { key: 'tortas', labelKey: 'tortas', toastGroups: ['tortas'], prepStation: 'LINEA', tile: 'bg-amber-50 border-amber-200', accent: 'bg-amber-600', units349d: 467201 },
    { key: 'super_burritos', labelKey: 'super_burritos', toastGroups: ['super burritos'], prepStation: 'LINEA', tile: 'bg-green-50 border-green-200', accent: 'bg-green-700', units349d: 410461 },
    { key: 'sopes', labelKey: 'sopes', toastGroups: ['sopes'], prepStation: 'PARRILLA', tile: 'bg-orange-50 border-orange-200', accent: 'bg-orange-600', units349d: 379905 },
    { key: 'mulitas', labelKey: 'mulitas', toastGroups: ['mulitas'], prepStation: 'PARRILLA', tile: 'bg-yellow-50 border-yellow-200', accent: 'bg-yellow-600', units349d: 362146 },
    { key: 'quesadillas', labelKey: 'quesadillas', toastGroups: ['quesadillas'], prepStation: 'PARRILLA', tile: 'bg-lime-50 border-lime-200', accent: 'bg-lime-700', units349d: 241802 },
    { key: 'sides', labelKey: 'sides', toastGroups: ['side orders'], prepStation: 'LINEA', tile: 'bg-stone-50 border-stone-200', accent: 'bg-stone-600', units349d: 192993 },
    { key: 'super_mulitas', labelKey: 'super_mulitas', toastGroups: ['super mulitas'], prepStation: 'PARRILLA', tile: 'bg-yellow-50 border-yellow-300', accent: 'bg-yellow-700', units349d: 185272 },
    { key: 'super_quesadillas', labelKey: 'super_quesadillas', toastGroups: ['super quesadillas'], prepStation: 'PARRILLA', tile: 'bg-lime-50 border-lime-300', accent: 'bg-lime-800', units349d: 153157 },
    { key: 'platos', labelKey: 'platos', toastGroups: ['platos'], prepStation: 'LINEA', tile: 'bg-teal-50 border-teal-200', accent: 'bg-teal-600', units349d: 145045 },
    { key: 'super_nachos', labelKey: 'super_nachos', toastGroups: ['super nachos'], prepStation: 'LINEA', tile: 'bg-rose-50 border-rose-200', accent: 'bg-rose-600', units349d: 106984 },
    { key: 'postres', labelKey: 'postres', toastGroups: ['desserts'], prepStation: 'NONE', tile: 'bg-pink-50 border-pink-200', accent: 'bg-pink-600', units349d: 75136 },
    { key: 'desayunos', labelKey: 'desayunos', toastGroups: ['desayunos'], prepStation: 'LINEA', tile: 'bg-indigo-50 border-indigo-200', accent: 'bg-indigo-600', units349d: 68647 },
    { key: 'combos', labelKey: 'combos', toastGroups: ['combos'], prepStation: 'PARRILLA', tile: 'bg-blue-50 border-blue-200', accent: 'bg-blue-600', units349d: 64152 },
    { key: 'pura_carne', labelKey: 'pura_carne', toastGroups: ['pura carne burritos', 'super pc burritos'], prepStation: 'LINEA', tile: 'bg-emerald-50 border-emerald-300', accent: 'bg-emerald-800', units349d: 37608 },
    { key: 'catering', labelKey: 'catering', toastGroups: ['catering'], prepStation: 'LINEA', tile: 'bg-purple-50 border-purple-200', accent: 'bg-purple-600', units349d: 7411 },
    { key: 'dt_condiments', labelKey: 'dt_condiments', toastGroups: ['dt condiments'], prepStation: 'NONE', tile: 'bg-slate-50 border-slate-300', accent: 'bg-slate-700', units349d: 72271, driveThruOnly: true },
]

export const PROTEIN_ORDER = ['asada', 'pastor', 'pollo', 'cabeza', 'lengua', 'carnitas', 'buche', 'chorizo'] as const
export type ProteinKey = typeof PROTEIN_ORDER[number]

/** Matriz rápida Proteína × Familia (familias de proteína con más volumen). */
export const MATRIX_COLUMNS: RegisterFamilyKey[] = ['tacos', 'burritos', 'super_burritos', 'tortas', 'sopes', 'mulitas', 'quesadillas']

/** Accent / case-insensitive normalization ("Piña" === "pina", "Jamón" === "jamon"). */
export function normalizeText(value: string | null | undefined): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s*\(in store\)\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
}

/** Maps a Toast group name ("In Store Menu > Tacos (In Store)") to a register family. Only In Store menus. */
export function familyFromToastGroup(groupName: string | null | undefined): RegisterFamilyKey | null {
    const raw = String(groupName || '')
    if (!/^in store (menu|drinks)\s*>/i.test(raw)) return null
    const g = normalizeText(raw.replace(/^in store (menu|drinks)\s*>\s*/i, ''))
    for (const fam of REGISTER_FAMILIES) {
        if (fam.toastGroups.includes(g)) return fam.key
    }
    return null
}

export function proteinOf(itemName: string): ProteinKey | null {
    const n = normalizeText(itemName)
    for (const p of PROTEIN_ORDER) {
        if (new RegExp(`\\b${p}\\b`).test(n)) return p
    }
    return null
}

/** Sort key: fixed protein order first, then non-protein items alphabetically. */
export function proteinSortKey(itemName: string): number {
    const p = proteinOf(itemName)
    return p ? PROTEIN_ORDER.indexOf(p) : PROTEIN_ORDER.length
}

export type HiddenReason = 'NEVER_SOLD_349D' | 'POS_TEST_ITEM' | 'SEPARATOR_REPLACED_BY_ACTION' | 'DISCOUNT_REPLACED_BY_MANAGER_APPROVAL' | 'DUPLICATE_GUID'

/** Returns why an item must not appear as a button (or null if it is visible). */
export function hiddenReasonFor(itemName: string, guid?: string): HiddenReason | null {
    const n = normalizeText(itemName)
    if (/separator/.test(n) || /^-{2,}/.test(String(itemName).trim())) return 'SEPARATOR_REPLACED_BY_ACTION'
    if (n === 'empleado' || n === 'policia') return 'DISCOUNT_REPLACED_BY_MANAGER_APPROVAL'
    if (n === 'test item' || n === 'test') return 'POS_TEST_ITEM'
    // Tripa: 0 unidades en 349 días en todas sus variantes excepto Taco Tripa (35 u → "Más…")
    if (/\btripa\b/.test(n) && n !== 'taco tripa') return 'NEVER_SOLD_349D'
    if (guid && DUPLICATE_GUIDS_TO_HIDE[guid]) return 'DUPLICATE_GUID'
    return null
}

/**
 * Same item exists twice in Toast with two GUIDs. Keep the one cashiers use most (349-day PMIX).
 * Large Horchata: 04c3493c… = 387,507 u (catalog) vs 717ae4d3… = 40,322 u.
 */
export const DUPLICATE_GUIDS_TO_HIDE: Record<string, string> = {
    '717ae4d3-04a7-4a24-83f7-e89111102a1e': 'Large Horchata (duplicate of 04c3493c-4f2c-4e95-b3ba-6872acaf2846)',
}

/** < 0.15 units/day chain-wide in 349 days → shown under "Más…" at the end of the family grid. */
export const SECONDARY_ITEMS = new Set([
    'taco tripa', 'plato jamon', 'mulita jamon', 'full flan', 'full cheesecake',
    'meat only super burrito chorizo', 'meat only super burrito buche',
])

export function isSecondaryItem(itemName: string): boolean {
    return SECONDARY_ITEMS.has(normalizeText(itemName))
}

// -----------------------------------------------------------------------------
// Required modifier groups (options live in DB: gavilan_pos_register_modifiers kind=REQUIRED)
// -----------------------------------------------------------------------------
export interface RequiredGroupRule {
    /** Key stored on the ticket line modifiers (unique per item) */
    groupKey: string
    /** DB option set (`gavilan_pos_register_modifiers.group_key`, kind=REQUIRED) */
    optionGroup: string
    /** i18n key under gavilan_pos.register.required */
    labelKey: string
    family: RegisterFamilyKey
    /** Regex (on normalized item name) of items that need this group; null = every item of the family */
    appliesTo: RegExp | null
    min: number
    max: number
    /** Options may be picked more than once (e.g. 3× Taco Asada in a Taco Plate) */
    allowRepeat: boolean
}

/**
 * Counts validated with PMIX (modifier picks per unit sold):
 * - Taco Plate ≈ 3 tacos (regla documentada en daily-order-consumption-engine).
 * - Party Trays: 2 carnes (≈1.9–2.0/u), 1 tortilla (≈1.0/u), aguas 15-20 → 3, 20-25 → 4, 25-30 → 5, 30-40 → 6.
 * - Carne por libra: se elige 1 carne por libra (las cajeras escribían "2 Pastor 2 Pollo 2 Lengua" en 6 lb).
 */
export const REQUIRED_GROUP_RULES: RequiredGroupRule[] = [
    { groupKey: 'tortilla', optionGroup: 'tortilla', labelKey: 'tortilla', family: 'platos', appliesTo: null, min: 1, max: 1, allowRepeat: false },
    { groupKey: 'tortilla', optionGroup: 'tortilla', labelKey: 'tortilla', family: 'desayunos', appliesTo: /^huevos\b/, min: 1, max: 1, allowRepeat: false },
    { groupKey: 'egg_style', optionGroup: 'egg_style', labelKey: 'egg_style', family: 'desayunos', appliesTo: /^huevos rancheros$/, min: 1, max: 1, allowRepeat: false },
    { groupKey: 'egg_style', optionGroup: 'egg_style', labelKey: 'egg_style', family: 'sides', appliesTo: /^egg$/, min: 1, max: 1, allowRepeat: false },
    { groupKey: 'queso_nachos', optionGroup: 'queso_nachos', labelKey: 'queso_nachos', family: 'super_nachos', appliesTo: null, min: 1, max: 1, allowRepeat: false },
    { groupKey: 'taco_pick', optionGroup: 'taco_pick', labelKey: 'taco_pick', family: 'combos', appliesTo: /^taco plate$/, min: 3, max: 3, allowRepeat: true },
    { groupKey: 'meat_pick', optionGroup: 'meat_pick', labelKey: 'meat_pick', family: 'sides', appliesTo: /^side order carne$/, min: 1, max: 1, allowRepeat: false },
    { groupKey: 'meat_lbs', optionGroup: 'meat_pick', labelKey: 'meat_lbs', family: 'catering', appliesTo: /^2 lb meat$/, min: 2, max: 2, allowRepeat: true },
    { groupKey: 'meat_lbs', optionGroup: 'meat_pick', labelKey: 'meat_lbs', family: 'catering', appliesTo: /^6 lb meat$/, min: 6, max: 6, allowRepeat: true },
    { groupKey: 'meat_lbs', optionGroup: 'meat_pick', labelKey: 'meat_lbs', family: 'catering', appliesTo: /^12 lb meat$/, min: 12, max: 12, allowRepeat: true },
    { groupKey: 'tray_meat', optionGroup: 'meat_pick', labelKey: 'meat_pick', family: 'catering', appliesTo: /^\d+ - \d+ people$/, min: 2, max: 2, allowRepeat: true },
    { groupKey: 'tray_agua', optionGroup: 'agua_pick', labelKey: 'agua_pick', family: 'catering', appliesTo: /^15 - 20 people$/, min: 3, max: 3, allowRepeat: true },
    { groupKey: 'tray_agua', optionGroup: 'agua_pick', labelKey: 'agua_pick', family: 'catering', appliesTo: /^20 - 25 people$/, min: 4, max: 4, allowRepeat: true },
    { groupKey: 'tray_agua', optionGroup: 'agua_pick', labelKey: 'agua_pick', family: 'catering', appliesTo: /^25 - 30 people$/, min: 5, max: 5, allowRepeat: true },
    { groupKey: 'tray_agua', optionGroup: 'agua_pick', labelKey: 'agua_pick', family: 'catering', appliesTo: /^30 - 40 people$/, min: 6, max: 6, allowRepeat: true },
    { groupKey: 'tray_tortilla', optionGroup: 'tortilla_pick', labelKey: 'tortilla', family: 'catering', appliesTo: /^\d+ - \d+ people$/, min: 1, max: 1, allowRepeat: false },
    { groupKey: 'gallon_agua', optionGroup: 'agua_pick', labelKey: 'agua_pick', family: 'catering', appliesTo: /^gallon agua$/, min: 1, max: 1, allowRepeat: false },
]

export function requiredRulesFor(family: RegisterFamilyKey | undefined, itemName: string): RequiredGroupRule[] {
    if (!family) return []
    const n = normalizeText(itemName)
    return REQUIRED_GROUP_RULES.filter(r => r.family === family && (r.appliesTo === null || r.appliesTo.test(n)))
}

// -----------------------------------------------------------------------------
// Discounts (replace Toast $0.00 "Empleado" / "Policia" buttons)
// -----------------------------------------------------------------------------
export type DiscountType = 'EMPLEADO' | 'POLICIA'
export const DISCOUNT_PRESETS: Record<DiscountType, { allowedPcts: number[]; defaultPct: number }> = {
    EMPLEADO: { allowedPcts: [50], defaultPct: 50 },
    POLICIA: { allowedPcts: [50, 100], defaultPct: 50 },
}

export function isAllowedDiscount(type: string, pct: number): type is DiscountType {
    const preset = (DISCOUNT_PRESETS as any)[type]
    return Boolean(preset) && preset.allowedPcts.includes(Number(pct))
}

// -----------------------------------------------------------------------------
// Catalog & ticket model
// -----------------------------------------------------------------------------
export interface RegisterCatalogItem {
    guid: string
    name: string
    family: RegisterFamilyKey
    price: number
    prepStation: PrepStation
    protein: ProteinKey | null
    secondary: boolean
    inStock: boolean
}

export interface RegisterModifierOption {
    id: string
    family: RegisterFamilyKey
    kind: 'CHIP' | 'REQUIRED' | 'NOTE'
    groupKey: string
    label: string
    toastGuid: string | null
    price: number
    isDefault: boolean
    isAlert: boolean
    usageUnits: number
    sortOrder: number
}

export interface RegisterLineModifier {
    name: string
    price: number
    isAlert?: boolean
    guid?: string | null
    kind?: 'CHIP' | 'REQUIRED' | 'NOTE' | 'ACTION'
    groupKey?: string
    /** For repeatable required options (e.g. 2× Taco Asada in Taco Plate) */
    count?: number
}

export interface RegisterCartLine {
    id: string
    guid: string
    name: string
    unitPrice: number
    qty: number
    prepStation: PrepStation
    modifiers: RegisterLineModifier[]
    family?: RegisterFamilyKey
    /** Plate / bag number (1-based). "Separar plato/bolsa" increments it. */
    plate?: number
}

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100

/** Unit price including modifiers (repeatable modifiers multiply by count). */
export function lineUnitPrice(line: Pick<RegisterCartLine, 'unitPrice' | 'modifiers'>): number {
    const mods = line.modifiers.reduce((s, m) => s + (Number(m.price) || 0) * Math.max(1, Number(m.count || 1)), 0)
    return round2((Number(line.unitPrice) || 0) + mods)
}

export function lineTotal(line: Pick<RegisterCartLine, 'unitPrice' | 'modifiers' | 'qty'>): number {
    return round2(lineUnitPrice(line) * Math.max(0, Number(line.qty) || 0))
}

export interface RequiredStatus { rule: RequiredGroupRule; picked: number; satisfied: boolean }

export function requiredStatusForLine(line: RegisterCartLine): RequiredStatus[] {
    return requiredRulesFor(line.family, line.name).map(rule => {
        const picked = line.modifiers
            .filter(m => m.kind === 'REQUIRED' && m.groupKey === rule.groupKey)
            .reduce((s, m) => s + Math.max(1, Number(m.count || 1)), 0)
        return { rule, picked, satisfied: picked >= rule.min && picked <= rule.max }
    })
}

export function cartHasUnmetRequired(lines: RegisterCartLine[]): boolean {
    return lines.some(l => requiredStatusForLine(l).some(s => !s.satisfied))
}

/** Lines grouped by plate/bag number, preserving insertion order. */
export function groupLinesByPlate(lines: RegisterCartLine[]): { plate: number; lines: RegisterCartLine[] }[] {
    const map = new Map<number, RegisterCartLine[]>()
    for (const l of lines) {
        const p = Math.max(1, Number(l.plate || 1))
        if (!map.has(p)) map.set(p, [])
        map.get(p)!.push(l)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([plate, ls]) => ({ plate, lines: ls }))
}

/** Plate word by dining mode: For Here → PLATO, To Go / Drive-Thru → BOLSA. */
export function plateWord(mode: DiningMode, isEs: boolean): string {
    if (mode === 'FOR HERE') return isEs ? 'PLATO' : 'PLATE'
    return isEs ? 'BOLSA' : 'BAG'
}

/** Kitchen/KDS modifier labels (repeat counts expanded, plate header when the order has >1 plate). */
export function kitchenModifierLabels(line: RegisterCartLine, plateCount: number, mode: DiningMode): string[] {
    const labels: string[] = []
    if (plateCount > 1) labels.push(`${plateWord(mode, true)} ${Math.max(1, Number(line.plate || 1))}`)
    for (const m of line.modifiers) {
        const c = Math.max(1, Number(m.count || 1))
        labels.push(c > 1 ? `${c}× ${m.name}` : m.name)
    }
    return labels
}

export function nextPlateNumber(lines: RegisterCartLine[]): number {
    return lines.reduce((max, l) => Math.max(max, Number(l.plate || 1)), 1) + 1
}

// -----------------------------------------------------------------------------
// Enterprise QSR Visual Taxonomy (Simphony / NP6 / Taco Bell / Square POS)
// -----------------------------------------------------------------------------
export interface ItemVisualStyle {
    /** Left accent bar & border styling */
    cardCls: string
    /** Badge background & text */
    badgeCls: string
    /** Short uppercase protein / variant tag for rapid visual scanning */
    tagLabel: string
    /** Price pill styling */
    priceCls: string
}

export const PROTEIN_VISUAL_STYLES: Record<ProteinKey, ItemVisualStyle> = {
    asada: {
        cardCls: 'bg-red-50/90 border-red-200 border-l-[6px] border-l-red-600 hover:bg-red-100/80',
        badgeCls: 'bg-red-600 text-white',
        tagLabel: 'ASADA',
        priceCls: 'bg-white/90 text-red-900 border border-red-200',
    },
    pastor: {
        cardCls: 'bg-orange-50/90 border-orange-200 border-l-[6px] border-l-orange-500 hover:bg-orange-100/80',
        badgeCls: 'bg-orange-600 text-white',
        tagLabel: 'PASTOR',
        priceCls: 'bg-white/90 text-orange-900 border border-orange-200',
    },
    pollo: {
        cardCls: 'bg-amber-50/90 border-amber-200 border-l-[6px] border-l-amber-500 hover:bg-amber-100/80',
        badgeCls: 'bg-amber-500 text-slate-950',
        tagLabel: 'POLLO',
        priceCls: 'bg-white/90 text-amber-950 border border-amber-200',
    },
    cabeza: {
        cardCls: 'bg-rose-50/90 border-rose-200 border-l-[6px] border-l-rose-600 hover:bg-rose-100/80',
        badgeCls: 'bg-rose-700 text-white',
        tagLabel: 'CABEZA',
        priceCls: 'bg-white/90 text-rose-900 border border-rose-200',
    },
    lengua: {
        cardCls: 'bg-purple-50/90 border-purple-200 border-l-[6px] border-l-purple-600 hover:bg-purple-100/80',
        badgeCls: 'bg-purple-700 text-white',
        tagLabel: 'LENGUA',
        priceCls: 'bg-white/90 text-purple-900 border border-purple-200',
    },
    carnitas: {
        cardCls: 'bg-yellow-50/90 border-yellow-300 border-l-[6px] border-l-yellow-700 hover:bg-yellow-100/80',
        badgeCls: 'bg-yellow-800 text-white',
        tagLabel: 'CARNITAS',
        priceCls: 'bg-white/90 text-yellow-950 border border-yellow-300',
    },
    buche: {
        cardCls: 'bg-teal-50/90 border-teal-200 border-l-[6px] border-l-teal-600 hover:bg-teal-100/80',
        badgeCls: 'bg-teal-700 text-white',
        tagLabel: 'BUCHE',
        priceCls: 'bg-white/90 text-teal-900 border border-teal-200',
    },
    chorizo: {
        cardCls: 'bg-red-100/70 border-red-300 border-l-[6px] border-l-red-900 hover:bg-red-100',
        badgeCls: 'bg-red-900 text-white',
        tagLabel: 'CHORIZO',
        priceCls: 'bg-white/90 text-red-950 border border-red-300',
    },
}

/**
 * Computes consistent QSR visual color coding for any register button so cashiers
 * recognize proteins, vegetarian options, specialty tortas, and drink sizes at a glance.
 */
export function itemVisualStyle(item: Pick<RegisterCatalogItem, 'name' | 'family' | 'protein'>): ItemVisualStyle {
    if (item.protein && PROTEIN_VISUAL_STYLES[item.protein]) {
        return PROTEIN_VISUAL_STYLES[item.protein]
    }
    const n = normalizeText(item.name)
    if (/\b(vegetariano|no carne|frijol y queso|queso)\b/.test(n)) {
        return {
            cardCls: 'bg-emerald-50/90 border-emerald-200 border-l-[6px] border-l-emerald-600 hover:bg-emerald-100/80',
            badgeCls: 'bg-emerald-700 text-white',
            tagLabel: /\bqueso\b/.test(n) && !/\bno carne\b/.test(n) ? 'QUESO' : 'VEGETARIANO',
            priceCls: 'bg-white/90 text-emerald-950 border border-emerald-200',
        }
    }
    if (/\bcubana\b/.test(n)) {
        return {
            cardCls: 'bg-amber-100/80 border-amber-300 border-l-[6px] border-l-amber-700 hover:bg-amber-100',
            badgeCls: 'bg-amber-800 text-white',
            tagLabel: 'ESPECIAL',
            priceCls: 'bg-white/90 text-amber-950 border border-amber-300',
        }
    }
    if (/\bmilanesa\b/.test(n)) {
        return {
            cardCls: 'bg-orange-50/90 border-orange-200 border-l-[6px] border-l-orange-600 hover:bg-orange-100/80',
            badgeCls: 'bg-orange-700 text-white',
            tagLabel: 'MILANESA',
            priceCls: 'bg-white/90 text-orange-950 border border-orange-200',
        }
    }
    if (/\b(jamon|salchicha)\b/.test(n)) {
        return {
            cardCls: 'bg-pink-50/90 border-pink-200 border-l-[6px] border-l-pink-600 hover:bg-pink-100/80',
            badgeCls: 'bg-pink-700 text-white',
            tagLabel: /\bjamon\b/.test(n) ? 'JAMÓN' : 'SALCHICHA',
            priceCls: 'bg-white/90 text-pink-950 border border-pink-200',
        }
    }
    if (item.family === 'bebidas') {
        if (/^large\b/.test(n)) {
            return {
                cardCls: 'bg-blue-50/90 border-blue-200 border-l-[6px] border-l-blue-600 hover:bg-blue-100/80',
                badgeCls: 'bg-blue-700 text-white',
                tagLabel: 'LARGE 32oz',
                priceCls: 'bg-white/90 text-blue-950 border border-blue-200',
            }
        }
        if (/^medium\b/.test(n)) {
            return {
                cardCls: 'bg-sky-50/90 border-sky-200 border-l-[6px] border-l-sky-500 hover:bg-sky-100/80',
                badgeCls: 'bg-sky-600 text-white',
                tagLabel: 'MEDIUM 22oz',
                priceCls: 'bg-white/90 text-sky-950 border border-sky-200',
            }
        }
        return {
            cardCls: 'bg-cyan-50/90 border-cyan-200 border-l-[6px] border-l-cyan-600 hover:bg-cyan-100/80',
            badgeCls: 'bg-cyan-700 text-white',
            tagLabel: 'BEBIDA',
            priceCls: 'bg-white/90 text-cyan-950 border border-cyan-200',
        }
    }
    const fam = REGISTER_FAMILIES.find(f => f.key === item.family)
    return {
        cardCls: `${fam?.tile || 'bg-slate-50 border-slate-200'} border-l-[6px] border-l-slate-600 hover:brightness-98`,
        badgeCls: 'bg-slate-700 text-white',
        tagLabel: (fam?.labelKey || 'ITEM').toUpperCase().slice(0, 10),
        priceCls: 'bg-white/90 text-slate-900 border border-slate-200',
    }
}

export type ModifierSemanticBucket = 'NO' | 'EXTRA' | 'PREP'

/**
 * Groups optional CHIP modifiers into semantic QSR rows:
 * - 'NO': Exclusions ("No Cebolla", "No Cilantro", "No Queso", "Tortilla No Grasa")
 * - 'EXTRA': Paid add-ons (price > 0, e.g. "Extra Carne", "Double Carne", "Jack Cheese")
 * - 'PREP': Free preparation / salsa / tortilla / cut instructions
 */
export function classifyModifierBucket(opt: Pick<RegisterModifierOption, 'label' | 'price' | 'isAlert'>): ModifierSemanticBucket {
    const n = normalizeText(opt.label)
    if (opt.price > 0) return 'EXTRA'
    if (opt.isAlert || /^no\b|\bno\s+(grasa|cebolla|cilantro|queso|crema|frijol|arroz|salsa|aguacate|guacamole|hielo|ice)\b|^sin\b/.test(n)) {
        return 'NO'
    }
    return 'PREP'
}

/**
 * Generates up to 3 smart cash bill denominations strictly greater than `total`
 * for 1-tap Fast Cash checkout (Toast Quick Order / Square Fast Cash pattern).
 */
export function smartCashDenominations(total: number): number[] {
    const t = round2(total)
    if (t <= 0) return []
    const candidates = new Set<number>()
    const nextDollar = Math.ceil(t)
    if (nextDollar > t) candidates.add(nextDollar)
    else candidates.add(nextDollar + 1)

    const next5 = Math.ceil((t + 0.01) / 5) * 5
    candidates.add(next5)

    const next10 = Math.ceil((t + 0.01) / 10) * 10
    candidates.add(next10)

    const next20 = Math.ceil((t + 0.01) / 20) * 20
    candidates.add(next20)

    for (const bill of [10, 20, 50, 100]) {
        if (bill > t) candidates.add(bill)
    }

    return [...candidates]
        .filter(v => v > t)
        .sort((a, b) => a - b)
        .slice(0, 3)
}

// -----------------------------------------------------------------------------
// Universal Split Payment & Multi-Tender Engine
// (Toast Multi-Tender / Square Split Check / Oracle Simphony Equal Payment /
//  California CDTFA Reg. 1603 & Revenue and Taxation Code §6373 EBT Compliance)
// -----------------------------------------------------------------------------
export type SplitPaymentMode = 'BY_AMOUNT' | 'BY_EQUAL' | 'BY_PLATE' | 'BY_ITEM'

export type SplitTenderMethod = 'CASH' | 'CARD_NFC' | 'EBT_FOOD' | 'EBT_CASH' | 'GIFT_CARD'

export interface SplitTenderLeg {
    id: string
    method: SplitTenderMethod
    /** Dollar amount applied toward the check */
    amount: number
    /** Optional cash bill handed by guest (when > amount, produces changeDue) */
    cashTendered?: number
    /** Human-readable leg description (e.g. 'Tramo #1', 'Persona 1/3', 'PLATO 1', 'Pagador 2') */
    label: string
}

export interface MultiTenderSummary {
    /** Discounted food subtotal before tax */
    subtotal: number
    /** Portion of food subtotal covered by EBT_FOOD (0% sales tax under CDTFA Reg. 1603 / R&TC §6373) */
    ebtFoodSubtotalCovered: number
    /** Remaining food subtotal subject to California sales tax */
    taxableRemainingSubtotal: number
    /** Calculated California sales tax on taxableRemainingSubtotal */
    taxAmount: number
    /** Total due after adjusting tax for any EBT_FOOD legs */
    adjustedOrderTotal: number
    /** Total non-EBT amount applied across CASH, CARD_NFC, EBT_CASH, GIFT_CARD */
    nonEbtPaid: number
    /** Total amount applied across all legs (ebtFoodSubtotalCovered + nonEbtPaid) */
    totalApplied: number
    /** Remaining unpaid balance on the check (0 when fully covered) */
    remainingDue: number
    /** Total applied from CASH legs toward the check */
    cashAppliedTotal: number
    /** Total physical cash bills handed by the customer */
    cashHandedTotal: number
    /** Physical cash change to hand back to customer */
    changeDue: number
    /** Total charged across CARD_NFC legs */
    cardChargedTotal: number
    /** Number of distinct card swipes/taps (each swipe incurs per-txn processor cents) */
    cardSwipeCount: number
    /** Total redeemed on GIFT_CARD legs */
    giftCardTotal: number
    /** Total charged on EBT_CASH (CalWORKs) legs */
    ebtCashTotal: number
    /** True if at least one leg uses CASH (triggers RJ12 Pin 2 + Pin 5 cash drawer kick) */
    requiresCashDrawerKick: boolean
    /** True when remainingDue <= 0.009 and adjustedOrderTotal > 0 */
    isFullyPaid: boolean
}

export const SPLIT_TENDER_METHOD_META: Record<SplitTenderMethod, {
    shortEs: string
    shortEn: string
    badgeCls: string
    iconEmoji: string
}> = {
    CARD_NFC: {
        shortEs: 'Tarjeta / NFC',
        shortEn: 'Card / NFC',
        badgeCls: 'bg-blue-100 text-blue-900 border-blue-300',
        iconEmoji: '💳',
    },
    CASH: {
        shortEs: 'Efectivo',
        shortEn: 'Cash',
        badgeCls: 'bg-emerald-100 text-emerald-900 border-emerald-300',
        iconEmoji: '💵',
    },
    EBT_FOOD: {
        shortEs: 'EBT Food (0% Tax)',
        shortEn: 'EBT Food (0% Tax)',
        badgeCls: 'bg-teal-100 text-teal-900 border-teal-300',
        iconEmoji: '🏛️',
    },
    EBT_CASH: {
        shortEs: 'EBT Cash',
        shortEn: 'EBT Cash',
        badgeCls: 'bg-purple-100 text-purple-900 border-purple-300',
        iconEmoji: '🏧',
    },
    GIFT_CARD: {
        shortEs: 'Gift Card',
        shortEn: 'Gift Card',
        badgeCls: 'bg-amber-100 text-amber-900 border-amber-300',
        iconEmoji: '🎁',
    },
}

/**
 * Computes exact California CDTFA Reg. 1603 / R&TC §6373 multi-tender totals
 * across any number of sequential payment legs (`CASH`, `CARD_NFC`, `EBT_FOOD`, `EBT_CASH`, `GIFT_CARD`).
 */
export function computeMultiTenderSummary(
    subtotal: number,
    taxRatePct: number,
    legs: SplitTenderLeg[]
): MultiTenderSummary {
    const cleanSubtotal = round2(Math.max(0, Number(subtotal || 0)))
    const cleanTaxRate = Math.max(0, Number(taxRatePct || 0))

    let rawEbtFood = 0
    let nonEbtPaid = 0
    let cashAppliedTotal = 0
    let cashHandedTotal = 0
    let cardChargedTotal = 0
    let cardSwipeCount = 0
    let giftCardTotal = 0
    let ebtCashTotal = 0

    for (const leg of legs) {
        const amt = round2(Math.max(0, Number(leg.amount || 0)))
        if (amt <= 0) continue
        if (leg.method === 'EBT_FOOD') {
            rawEbtFood = round2(rawEbtFood + amt)
        } else {
            nonEbtPaid = round2(nonEbtPaid + amt)
            if (leg.method === 'CASH') {
                cashAppliedTotal = round2(cashAppliedTotal + amt)
                const handed = round2(Math.max(amt, Number(leg.cashTendered ?? amt)))
                cashHandedTotal = round2(cashHandedTotal + handed)
            } else if (leg.method === 'CARD_NFC') {
                cardChargedTotal = round2(cardChargedTotal + amt)
                cardSwipeCount += 1
            } else if (leg.method === 'GIFT_CARD') {
                giftCardTotal = round2(giftCardTotal + amt)
            } else if (leg.method === 'EBT_CASH') {
                ebtCashTotal = round2(ebtCashTotal + amt)
            }
        }
    }

    // Under CDTFA Reg. 1603 / R&TC §6373, EBT SNAP/CalFresh food benefits apply directly
    // to the food subtotal first and are 100% exempt from state/local sales tax.
    const ebtFoodSubtotalCovered = round2(Math.min(cleanSubtotal, rawEbtFood))
    const taxableRemainingSubtotal = round2(Math.max(0, cleanSubtotal - ebtFoodSubtotalCovered))
    const taxAmount = taxableRemainingSubtotal <= 0
        ? 0
        : round2((taxableRemainingSubtotal * cleanTaxRate) / 100)
    const adjustedOrderTotal = round2(cleanSubtotal + taxAmount)

    const totalApplied = round2(ebtFoodSubtotalCovered + nonEbtPaid)
    const remainingDue = round2(Math.max(0, adjustedOrderTotal - totalApplied))
    const overpaidNonEbt = round2(Math.max(0, totalApplied - adjustedOrderTotal))
    const explicitCashOver = round2(Math.max(0, cashHandedTotal - cashAppliedTotal))
    const changeDue = round2(explicitCashOver + (cashAppliedTotal > 0 ? overpaidNonEbt : 0))

    return {
        subtotal: cleanSubtotal,
        ebtFoodSubtotalCovered,
        taxableRemainingSubtotal,
        taxAmount,
        adjustedOrderTotal,
        nonEbtPaid,
        totalApplied,
        remainingDue,
        cashAppliedTotal,
        cashHandedTotal,
        changeDue,
        cardChargedTotal,
        cardSwipeCount,
        giftCardTotal,
        ebtCashTotal,
        requiresCashDrawerKick: cashAppliedTotal > 0,
        isFullyPaid: adjustedOrderTotal > 0 && remainingDue <= 0.009,
    }
}

/**
 * Splits an order into `ways` equal shares (2..10), assigning any $0.01 rounding
 * remainder to the final share and respecting 0% tax on any share paid via `EBT_FOOD`.
 */
export function computeEqualSplitLegs(
    subtotal: number,
    taxRatePct: number,
    ways: number,
    methodsByShare: SplitTenderMethod[],
    isEs = true
): SplitTenderLeg[] {
    const n = Math.max(2, Math.min(10, Math.floor(Number(ways) || 2)))
    const cleanSubtotal = round2(Math.max(0, Number(subtotal || 0)))
    if (cleanSubtotal <= 0) return []

    // 1. Divide food subtotal into N equal parts with exact cent remainder on the last share
    const baseSubShare = Math.floor((cleanSubtotal * 100) / n) / 100
    const subShares: number[] = []
    let accSub = 0
    for (let i = 0; i < n; i++) {
        if (i === n - 1) {
            subShares.push(round2(cleanSubtotal - accSub))
        } else {
            subShares.push(baseSubShare)
            accSub = round2(accSub + baseSubShare)
        }
    }

    // 2. Determine methods for each share
    const resolvedMethods: SplitTenderMethod[] = []
    for (let i = 0; i < n; i++) {
        resolvedMethods.push(methodsByShare[i] || 'CARD_NFC')
    }

    // 3. Calculate total taxable subtotal across non-EBT_FOOD shares so total tax matches CDTFA Reg. 1603
    const taxableIndexes: number[] = []
    let taxableSubSum = 0
    for (let i = 0; i < n; i++) {
        if (resolvedMethods[i] !== 'EBT_FOOD') {
            taxableIndexes.push(i)
            taxableSubSum = round2(taxableSubSum + subShares[i])
        }
    }
    const totalTax = taxableSubSum <= 0 ? 0 : round2((taxableSubSum * Math.max(0, taxRatePct)) / 100)

    const taxShares = new Array<number>(n).fill(0)
    if (taxableIndexes.length > 0 && totalTax > 0) {
        let accTax = 0
        for (let k = 0; k < taxableIndexes.length; k++) {
            const idx = taxableIndexes[k]
            if (k === taxableIndexes.length - 1) {
                taxShares[idx] = round2(totalTax - accTax)
            } else {
                const shareTax = Math.floor(((subShares[idx] / taxableSubSum) * totalTax) * 100) / 100
                taxShares[idx] = shareTax
                accTax = round2(accTax + shareTax)
            }
        }
    }

    return subShares.map((sub, i) => ({
        id: `equal-${i + 1}`,
        method: resolvedMethods[i],
        amount: round2(sub + taxShares[i]),
        label: isEs ? `Persona ${i + 1} de ${n}` : `Guest ${i + 1} of ${n}`,
    }))
}

export interface SplitGroupInput {
    key: string
    label: string
    rawSubtotal: number
    method: SplitTenderMethod
}

/**
 * Computes exact split tender legs for Plate/Bag Split (`BY_PLATE`) or Item/Payer Split (`BY_ITEM`),
 * prorating order discounts across groups and applying 0% tax to any group tendered with `EBT_FOOD`.
 */
export function computeGroupSplitLegs(
    groups: SplitGroupInput[],
    discountedSubtotal: number,
    taxRatePct: number
): SplitTenderLeg[] {
    const active = groups.filter(g => g.rawSubtotal > 0)
    const cleanSub = round2(Math.max(0, Number(discountedSubtotal || 0)))
    if (active.length === 0 || cleanSub <= 0) return []

    const rawTotal = active.reduce((s, g) => round2(s + g.rawSubtotal), 0)
    if (rawTotal <= 0) return []

    // 1. Prorate discountedSubtotal across active groups to the exact penny
    const netSubShares: number[] = []
    let accSub = 0
    for (let i = 0; i < active.length; i++) {
        if (i === active.length - 1) {
            netSubShares.push(round2(Math.max(0, cleanSub - accSub)))
        } else {
            const share = round2((active[i].rawSubtotal / rawTotal) * cleanSub)
            netSubShares.push(share)
            accSub = round2(accSub + share)
        }
    }

    // 2. Compute tax only on non-EBT_FOOD groups
    const taxableIndexes: number[] = []
    let taxableSubSum = 0
    for (let i = 0; i < active.length; i++) {
        if (active[i].method !== 'EBT_FOOD') {
            taxableIndexes.push(i)
            taxableSubSum = round2(taxableSubSum + netSubShares[i])
        }
    }
    const totalTax = taxableSubSum <= 0 ? 0 : round2((taxableSubSum * Math.max(0, taxRatePct)) / 100)

    const taxShares = new Array<number>(active.length).fill(0)
    if (taxableIndexes.length > 0 && totalTax > 0) {
        let accTax = 0
        for (let k = 0; k < taxableIndexes.length; k++) {
            const idx = taxableIndexes[k]
            if (k === taxableIndexes.length - 1) {
                taxShares[idx] = round2(totalTax - accTax)
            } else {
                const shareTax = round2((netSubShares[idx] / taxableSubSum) * totalTax)
                taxShares[idx] = shareTax
                accTax = round2(accTax + shareTax)
            }
        }
    }

    return active.map((g, i) => ({
        id: `grp-${g.key}`,
        method: g.method,
        amount: round2(netSubShares[i] + taxShares[i]),
        label: g.label,
    }))
}

/**
 * Formats a concise receipt & database description of all legs in a Multi-Tender order.
 */
export function formatSplitTenderReceiptLabel(
    mode: SplitPaymentMode,
    legs: SplitTenderLeg[],
    summary: MultiTenderSummary
): string {
    const modeTag =
        mode === 'BY_EQUAL'
            ? `PARTES IGUALES (${legs.length})`
            : mode === 'BY_PLATE'
                ? `POR PLATO/BOLSA (${legs.length})`
                : mode === 'BY_ITEM'
                    ? `POR ARTÍCULOS (${legs.length})`
                    : `MULTI-MÉTODO (${legs.length})`
    const parts = legs
        .filter(l => l.amount > 0)
        .map(l => `${SPLIT_TENDER_METHOD_META[l.method].shortEs} $${l.amount.toFixed(2)}`)
    const changeTag = summary.changeDue > 0 ? ` · CAMBIO $${summary.changeDue.toFixed(2)}` : ''
    return `PAGO DIVIDIDO [${modeTag}]: ${parts.join(' + ')}${changeTag}`
}

// -----------------------------------------------------------------------------
// Drive-Thru & Counter Beverage Organization Engine
// Eliminates alphabetical chaos by grouping drinks into 3 operational zones
// (Aguas Frescas -> Sodas/Dispensador -> Calientes/Botella/Ollas) and pairing
// Medium 22oz + Large 32oz side-by-side inside each flavor card.
// -----------------------------------------------------------------------------
export type BeverageCategory = 'AGUAS_FRESCAS' | 'SODAS_FOUNTAIN' | 'HOT_BOTTLED_OLLA'

export type BeverageSize = 'MEDIUM' | 'LARGE' | 'SINGLE'

export type BeverageViewFilter = 'PAIRED' | 'LARGE_ONLY' | 'MEDIUM_ONLY' | 'HOT_ONLY'

export interface BeverageFlavorMeta {
    flavorKey: string
    category: BeverageCategory
    size: BeverageSize
    displayEs: string
    displayEn: string
    emoji: string
    accentBorderCls: string
    cardTintCls: string
    flavorBadgeCls: string
    sortOrder: number
}

interface FlavorDefinition {
    flavorKey: string
    match: RegExp
    category: BeverageCategory
    displayEs: string
    displayEn: string
    emoji: string
    accentBorderCls: string
    cardTintCls: string
    flavorBadgeCls: string
    baseOrder: number
}

const BEVERAGE_FLAVOR_DEFINITIONS: FlavorDefinition[] = [
    // 1. AGUAS FRESCAS CASERAS (Ordered by real chain sales: Horchata #1 -> Jamaica #2 -> Piña #3 -> Tamarindo #4)
    {
        flavorKey: 'horchata',
        match: /\bhorchata\b/,
        category: 'AGUAS_FRESCAS',
        displayEs: 'Horchata',
        displayEn: 'Horchata',
        emoji: '🥛',
        accentBorderCls: 'border-l-amber-600',
        cardTintCls: 'bg-amber-50/75 border-amber-200',
        flavorBadgeCls: 'bg-amber-600 text-white',
        baseOrder: 10,
    },
    {
        flavorKey: 'jamaica',
        match: /\bjamaica\b/,
        category: 'AGUAS_FRESCAS',
        displayEs: 'Jamaica',
        displayEn: 'Hibiscus (Jamaica)',
        emoji: '🌺',
        accentBorderCls: 'border-l-rose-700',
        cardTintCls: 'bg-rose-50/75 border-rose-200',
        flavorBadgeCls: 'bg-rose-700 text-white',
        baseOrder: 20,
    },
    {
        flavorKey: 'pina',
        match: /\bpina\b/,
        category: 'AGUAS_FRESCAS',
        displayEs: 'Piña',
        displayEn: 'Pineapple (Piña)',
        emoji: '🍍',
        accentBorderCls: 'border-l-yellow-500',
        cardTintCls: 'bg-yellow-50/80 border-yellow-300',
        flavorBadgeCls: 'bg-yellow-500 text-slate-950',
        baseOrder: 30,
    },
    {
        flavorKey: 'tamarindo',
        match: /\btamarindo\b/,
        category: 'AGUAS_FRESCAS',
        displayEs: 'Tamarindo',
        displayEn: 'Tamarind',
        emoji: '🤎',
        accentBorderCls: 'border-l-orange-800',
        cardTintCls: 'bg-orange-50/75 border-orange-200',
        flavorBadgeCls: 'bg-orange-800 text-white',
        baseOrder: 40,
    },

    // 2. SODAS Y REFRESCOS DE FUENTE / DISPENSADOR (Ordered by real Drive-Thru demand)
    {
        flavorKey: 'coke_zero',
        match: /\bcoke zero\b/,
        category: 'SODAS_FOUNTAIN',
        displayEs: 'Coke Zero',
        displayEn: 'Coke Zero',
        emoji: '⚫',
        accentBorderCls: 'border-l-slate-900',
        cardTintCls: 'bg-slate-100/85 border-slate-300',
        flavorBadgeCls: 'bg-slate-900 text-white',
        baseOrder: 180,
    },
    {
        flavorKey: 'diet_coke',
        match: /\bdiet coke\b/,
        category: 'SODAS_FOUNTAIN',
        displayEs: 'Diet Coke',
        displayEn: 'Diet Coke',
        emoji: '🥤',
        accentBorderCls: 'border-l-slate-500',
        cardTintCls: 'bg-slate-50 border-slate-300',
        flavorBadgeCls: 'bg-slate-600 text-white',
        baseOrder: 170,
    },
    {
        flavorKey: 'coke',
        match: /\bcoke\b/,
        category: 'SODAS_FOUNTAIN',
        displayEs: 'Coca-Cola',
        displayEn: 'Coca-Cola (Coke)',
        emoji: '🥤',
        accentBorderCls: 'border-l-red-600',
        cardTintCls: 'bg-red-50/75 border-red-200',
        flavorBadgeCls: 'bg-red-600 text-white',
        baseOrder: 110,
    },
    {
        flavorKey: 'sprite',
        match: /\bsprite\b/,
        category: 'SODAS_FOUNTAIN',
        displayEs: 'Sprite',
        displayEn: 'Sprite',
        emoji: '🍋',
        accentBorderCls: 'border-l-emerald-600',
        cardTintCls: 'bg-emerald-50/75 border-emerald-200',
        flavorBadgeCls: 'bg-emerald-600 text-white',
        baseOrder: 120,
    },
    {
        flavorKey: 'orange_fanta',
        match: /\borange fanta\b/,
        category: 'SODAS_FOUNTAIN',
        displayEs: 'Fanta Naranja',
        displayEn: 'Orange Fanta',
        emoji: '🍊',
        accentBorderCls: 'border-l-orange-500',
        cardTintCls: 'bg-orange-50/80 border-orange-200',
        flavorBadgeCls: 'bg-orange-500 text-white',
        baseOrder: 130,
    },
    {
        flavorKey: 'strawberry_fanta',
        match: /\bstrawberry fanta\b/,
        category: 'SODAS_FOUNTAIN',
        displayEs: 'Fanta Fresa',
        displayEn: 'Strawberry Fanta',
        emoji: '🍓',
        accentBorderCls: 'border-l-pink-600',
        cardTintCls: 'bg-pink-50/80 border-pink-200',
        flavorBadgeCls: 'bg-pink-600 text-white',
        baseOrder: 140,
    },
    {
        flavorKey: 'lemonade',
        match: /\blemonade\b/,
        category: 'SODAS_FOUNTAIN',
        displayEs: 'Limonada',
        displayEn: 'Lemonade',
        emoji: '🍋',
        accentBorderCls: 'border-l-amber-400',
        cardTintCls: 'bg-amber-50/75 border-amber-200',
        flavorBadgeCls: 'bg-amber-500 text-slate-950',
        baseOrder: 150,
    },
    {
        flavorKey: 'iced_tea',
        match: /\biced tea\b/,
        category: 'SODAS_FOUNTAIN',
        displayEs: 'Té Helado (Iced Tea)',
        displayEn: 'Iced Tea',
        emoji: '🧊',
        accentBorderCls: 'border-l-amber-700',
        cardTintCls: 'bg-amber-50/70 border-amber-200',
        flavorBadgeCls: 'bg-amber-800 text-white',
        baseOrder: 160,
    },

    // 3. CALIENTES, AGUA EMBOTELLADA Y OLLAS
    {
        flavorKey: 'bottled_water',
        match: /\bbottled water\b/,
        category: 'HOT_BOTTLED_OLLA',
        displayEs: 'Agua Embotellada',
        displayEn: 'Bottled Water',
        emoji: '💧',
        accentBorderCls: 'border-l-cyan-500',
        cardTintCls: 'bg-cyan-50/85 border-cyan-200',
        flavorBadgeCls: 'bg-cyan-600 text-white',
        baseOrder: 210,
    },
    {
        flavorKey: 'champurrado',
        match: /^champurrado$/,
        category: 'HOT_BOTTLED_OLLA',
        displayEs: 'Champurrado (16oz)',
        displayEn: 'Champurrado (16oz)',
        emoji: '🍫',
        accentBorderCls: 'border-l-amber-900',
        cardTintCls: 'bg-amber-100/70 border-amber-300',
        flavorBadgeCls: 'bg-amber-900 text-white',
        baseOrder: 220,
    },
    {
        flavorKey: 'cafe_de_olla',
        match: /^cafe de olla$/,
        category: 'HOT_BOTTLED_OLLA',
        displayEs: 'Café de Olla (16oz)',
        displayEn: 'Café de Olla (16oz)',
        emoji: '☕',
        accentBorderCls: 'border-l-amber-800',
        cardTintCls: 'bg-amber-50/85 border-amber-200',
        flavorBadgeCls: 'bg-amber-800 text-white',
        baseOrder: 230,
    },
    {
        flavorKey: 'coffee',
        match: /^coffee$/,
        category: 'HOT_BOTTLED_OLLA',
        displayEs: 'Café Regular (16oz)',
        displayEn: 'Regular Coffee (16oz)',
        emoji: '☕',
        accentBorderCls: 'border-l-stone-700',
        cardTintCls: 'bg-stone-100/80 border-stone-300',
        flavorBadgeCls: 'bg-stone-700 text-white',
        baseOrder: 240,
    },
    {
        flavorKey: 'olla_champurrado',
        match: /\bolla champurrado\b/,
        category: 'HOT_BOTTLED_OLLA',
        displayEs: 'Olla Champurrado',
        displayEn: 'Champurrado Pot (Olla)',
        emoji: '🍯',
        accentBorderCls: 'border-l-purple-700',
        cardTintCls: 'bg-purple-50/80 border-purple-200',
        flavorBadgeCls: 'bg-purple-700 text-white',
        baseOrder: 250,
    },
    {
        flavorKey: 'olla_cafe_de_olla',
        match: /\bolla cafe de olla\b/,
        category: 'HOT_BOTTLED_OLLA',
        displayEs: 'Olla Café de Olla',
        displayEn: 'Café de Olla Pot (Olla)',
        emoji: '🍯',
        accentBorderCls: 'border-l-purple-700',
        cardTintCls: 'bg-purple-50/80 border-purple-200',
        flavorBadgeCls: 'bg-purple-700 text-white',
        baseOrder: 260,
    },
]

/**
 * Classifies any beverage item by operational Drive-Thru category, canonical flavor,
 * and size (`MEDIUM` 22oz, `LARGE` 32oz, or `SINGLE`).
 */
export function classifyBeverageItem(itemName: string): BeverageFlavorMeta {
    const n = normalizeText(itemName)
    const size: BeverageSize = /^large\b/.test(n)
        ? 'LARGE'
        : /^medium\b/.test(n)
            ? 'MEDIUM'
            : 'SINGLE'

    for (const def of BEVERAGE_FLAVOR_DEFINITIONS) {
        if (def.match.test(n)) {
            // Within the same flavor, Medium (22oz) sorts right before Large (32oz)
            const sizeOffset = size === 'MEDIUM' ? 0 : size === 'LARGE' ? 1 : 2
            return {
                flavorKey: def.flavorKey,
                category: def.category,
                size,
                displayEs: def.displayEs,
                displayEn: def.displayEn,
                emoji: def.emoji,
                accentBorderCls: def.accentBorderCls,
                cardTintCls: def.cardTintCls,
                flavorBadgeCls: def.flavorBadgeCls,
                sortOrder: def.baseOrder + sizeOffset,
            }
        }
    }

    const stripped = String(itemName || '').replace(/^(Large|Medium)\s+/i, '').replace(/\s*\(In Store\)\s*$/i, '').trim()
    return {
        flavorKey: normalizeText(stripped) || 'other_drink',
        category: 'HOT_BOTTLED_OLLA',
        size,
        displayEs: stripped || itemName,
        displayEn: stripped || itemName,
        emoji: '🥤',
        accentBorderCls: 'border-l-sky-600',
        cardTintCls: 'bg-sky-50/75 border-sky-200',
        flavorBadgeCls: 'bg-sky-700 text-white',
        sortOrder: 300,
    }
}

/** Deterministic sort key for `bebidas` items so Aguas Frescas -> Sodas -> Hot/Bottled always sort cleanly. */
export function beverageSortKey(itemName: string): number {
    return classifyBeverageItem(itemName).sortOrder
}

export interface BeverageFlavorPair {
    flavorKey: string
    category: BeverageCategory
    displayEs: string
    displayEn: string
    emoji: string
    accentBorderCls: string
    cardTintCls: string
    flavorBadgeCls: string
    sortOrder: number
    mediumItem: RegisterCatalogItem | null
    largeItem: RegisterCatalogItem | null
    singleItem: RegisterCatalogItem | null
}

/**
 * Groups `bebidas` items into 3 Drive-Thru sections (`aguasFrescas`, `sodasFountain`, `hotAndBottled`),
 * pairing `Medium 22oz` and `Large 32oz` on the same flavor card so the cashier never hunts across rows.
 */
export function groupBeveragesByFlavor(items: RegisterCatalogItem[]): {
    aguasFrescas: BeverageFlavorPair[]
    sodasFountain: BeverageFlavorPair[]
    hotAndBottled: BeverageFlavorPair[]
} {
    const map = new Map<string, BeverageFlavorPair>()
    for (const item of items) {
        if (item.family !== 'bebidas') continue
        const meta = classifyBeverageItem(item.name)
        let entry = map.get(meta.flavorKey)
        if (!entry) {
            entry = {
                flavorKey: meta.flavorKey,
                category: meta.category,
                displayEs: meta.displayEs,
                displayEn: meta.displayEn,
                emoji: meta.emoji,
                accentBorderCls: meta.accentBorderCls,
                cardTintCls: meta.cardTintCls,
                flavorBadgeCls: meta.flavorBadgeCls,
                sortOrder: meta.sortOrder,
                mediumItem: null,
                largeItem: null,
                singleItem: null,
            }
            map.set(meta.flavorKey, entry)
        }
        if (meta.size === 'MEDIUM') entry.mediumItem = item
        else if (meta.size === 'LARGE') entry.largeItem = item
        else entry.singleItem = item
    }

    const all = [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder)
    return {
        aguasFrescas: all.filter(p => p.category === 'AGUAS_FRESCAS'),
        sodasFountain: all.filter(p => p.category === 'SODAS_FOUNTAIN'),
        hotAndBottled: all.filter(p => p.category === 'HOT_BOTTLED_OLLA'),
    }
}

/**
 * Given a cold drink item name (`Medium Horchata` or `Large Horchata`), finds its opposite-size
 * counterpart (`Large Horchata` or `Medium Horchata`) for 1-tap size swapping on the ticket.
 */
export function findCounterpartBeverageSize(
    currentItemName: string,
    bebidasItems: RegisterCatalogItem[]
): RegisterCatalogItem | null {
    const meta = classifyBeverageItem(currentItemName)
    if (meta.size !== 'MEDIUM' && meta.size !== 'LARGE') return null
    const targetSize: BeverageSize = meta.size === 'MEDIUM' ? 'LARGE' : 'MEDIUM'
    return (
        bebidasItems.find(it => {
            const m = classifyBeverageItem(it.name)
            return m.flavorKey === meta.flavorKey && m.size === targetSize
        }) || null
    )
}

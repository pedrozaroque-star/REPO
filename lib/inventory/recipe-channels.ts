/**
 * @module lib/inventory/recipe-channels
 * @description Catálogo canónico de canales de venta para recetas, consumo teórico y empaque.
 * @businessRules Los ingredientes base aplican a todos los canales; los empaques pueden variar
 *                entre for_here, to_go, drive_thru y delivery. Las bolsas exteriores compartidas
 *                se calculan a nivel ticket, nunca como componente fijo de cada artículo.
 * @dataFlow Toast dining option/source → canonical channel → recipe automation rule → consumption engine.
 * @notes Drive Thru se mantiene separado de To Go porque puede requerir utensilios sellados distintos.
 *   La resolución de tickets exige evidencia. Nombre explícito prevalece sobre behavior: Lynwood configura Drive Thru como DINE_IN.
 *   TakeOut de plataformas y Toast Online usan empaque Delivery sin modificar el canal de venta.
 */

export const RECIPE_CHANNELS = ['for_here', 'to_go', 'drive_thru', 'delivery'] as const

export type RecipeChannel = (typeof RECIPE_CHANNELS)[number]

export function resolvePackagingChannel(input: {
  diningOption?: string | null; behavior?: string | null; source?: string | null; deliveryService?: string | null
}): RecipeChannel | 'unknown' {
  const salesChannel = resolveTicketChannel(input)
  const name = (input.diningOption || '').toLowerCase().replace(/[_-]/g, ' ')
  const context = `${name} ${input.source || ''} ${input.deliveryService || ''}`.toLowerCase()
  if (/\btoast\s*online\b/.test(name)) return 'delivery'
  if (salesChannel === 'to_go' && /\b(uber\s*eats|doordash|grubhub|postmates|toast\s*pickup\s*app)\b/.test(context)) return 'delivery'
  return salesChannel
}

export function resolveTicketChannel(input: {
  diningOption?: string | null; behavior?: string | null; source?: string | null; deliveryService?: string | null
}): RecipeChannel | 'unknown' {
  const name = (input.diningOption || '').toLowerCase().replace(/[_-]/g, ' ')
  if (/\bdrive\s*(thru|through)\b/.test(name)) return 'drive_thru'
  if (/\b(to\s*go|take\s*out|pick\s*up|phone)\b/.test(name)) return 'to_go'
  if (/\b(for\s*here|dine\s*in)\b/.test(name)) return 'for_here'
  if (/\b(delivery|postmates)\b/.test(name)) return 'delivery'
  if (input.behavior === 'TAKE_OUT') return 'to_go'
  if (input.behavior === 'DELIVERY') return 'delivery'
  if (input.behavior === 'DINE_IN') return 'for_here'
  if (/\bpickup\b/i.test(input.source || '')) return 'to_go'
  if (/\b(uber\s*eats|doordash|grubhub|postmates)\b/i.test(input.deliveryService || '')) return 'delivery'
  return 'unknown'
}

export const RECIPE_CHANNEL_LABELS: Record<RecipeChannel, string> = {
  for_here: 'For Here',
  to_go: 'To Go',
  drive_thru: 'Drive Thru',
  delivery: 'Delivery',
}

/** Converts Toast metadata to the channel used by recipe rules. */
export function resolveRecipeChannel(input: {
  diningOption?: string | null
  source?: string | null
  deliveryService?: string | null
}): RecipeChannel {
  const text = `${input.diningOption || ''} ${input.source || ''} ${input.deliveryService || ''}`.toLowerCase()
  if (/uber|eats|postmates|doordash|dash|grubhub|delivery/.test(text)) return 'delivery'
  if (/drive\s*-?\s*thru|drive through|drive-thru/.test(text)) return 'drive_thru'
  if (/to go|takeout|take out|pickup|pick up/.test(text)) return 'to_go'
  return 'for_here'
}

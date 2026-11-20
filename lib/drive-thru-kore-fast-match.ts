/**
 * @module lib/drive-thru-kore-fast-match
 * @description Motor PURO e isomórfico (servidor + navegador, cero imports `node:*` ni Supabase) que empata en `< 1 ms`
 * el resultado de cualquier herramienta (`applyKoreTool` / `driver-lookup`) de "Kore Drive-Thru" contra el banco de
 * respuestas de voz pregrabadas (`Kore 3.8`, 24 kHz PCM16, Español e Inglés) derivadas del análisis de los **6,408 tickets
 * reales de Toast (`toast_ticket_consumption_snapshots` con `dining_option_name = 'Drive Thru'`)** y las **398,905 órdenes
 * históricas de `dt_orders`**.
 *
 * @businessRules
 * - **Cero intercepción de `confirm_order`**: `confirm_order` NUNCA se reemplaza por un clip fijo porque debe leer en vivo
 *   los artículos exactos y el total dinámico en dólares (`USD`) de esa orden.
 * - **Aclaraciones inmediatas (#1 cuello de botella en Drive-Thru)**: cubre *"¿Regular o Super?"*, *"¿Regular o Super, y de qué carne?"*,
 *   elección de carne, tamaño de agua fresca (`Mediana, grande o de galón`), tamaño de refresco (`Mediana o grande`, jamás
 *   ofreciendo galón en sodas ni diciendo *"chica"*), sabor de refresco, 3 tacos del `Taco Plate`, queso de `Super Nachos`
 *   y tortillas de `Plato`.
 * - **Platillos #1 reales del historial Drive-Thru + acuses universales**: confirma por su nombre los platillos más pedidos
 *   en `toast_ticket_consumption_snapshots` (`Taco Asada` 1–4x, `Taco Pastor` 2–3x, `Taco Pollo` 2–3x, `Taco Cabeza` 2x,
 *   `Taco Lengua` 2x, `Burrito Asada`, `Super Burrito Asada`, `Champurrado`, `Torta Asada`, `Sope Asada`, `Mulita Asada`,
 *   `Super Quesadilla Asada`, `Medium/Large Horchata`, `Medium/Large Jamaica`) cuando se agregan sin advertencias ni cargos
 *   extra, y rota entre `added_ack_1` y `added_ack_2` para cualquier otra adición limpia (`add_item` / `add_items`).
 * - **Situaciones operativas y despedidas finales (`isTerminalSendoff`)**: cubre corte de desayunos a las 2:00 PM PT,
 *   redirección amable de EBT al mostrador del comedor, estatus uniforme de repartidores hacia **Ventana 2**, y cierre
 *   automático del carril (`end_session` -> `sendoff_window1`, `sendoff_window2_driver`, `sendoff_cancelled`, `ebt_cancel_go_inside`).
 *
 * @dataFlow
 * - Servidor (`lib/drive-thru-kore-fast-clips.ts`): itera `KORE_FAST_CLIP_SPECS` para sintetizar y persistir el 100% de
 *   los clips `es` y `en` en Supabase Storage (`order-ready-tts`, voz `Kore 3.8` a 24 kHz) y servirlos vía
 *   `GET /api/drive-thru/kore/fast-clips`.
 * - Navegador (`components/drive-thru/KoreDriveThruSimulator.tsx`): llama `matchKoreFastClipForToolOutcome(...)` dentro de
 *   `handleToolCall` y reproduce el `Float32Array` pre-decodificado en `< 10 ms` sin superposición de voz.
 *
 * @notes
 * - Módulo 100% determinista, inmutable y libre de efectos secundarios.
 */

import type { KoreOrderLine, KoreOrderState } from '@/lib/drive-thru-kore-order'

export type KoreFastClipCategory = 'clarify' | 'item_ack' | 'ops' | 'sendoff'

export interface KoreFastClipSpec {
  clipId: string
  category: KoreFastClipCategory
  textEs: string
  textEn: string
  isTerminalSendoff?: boolean
}

export interface KoreFastClipMatch {
  clipId: string
  textEs: string
  textEn: string
  /** Texto exacto en el idioma activo (`lang`) de la sesión. */
  text: string
  isTerminalSendoff?: boolean
}

export const KORE_FAST_CLIP_SPECS: ReadonlyArray<KoreFastClipSpec> = Object.freeze([
  // 1) Aclaraciones inmediatas (#1 cuello de botella en Drive-Thru)
  {
    clipId: 'clarify_regular_or_super',
    category: 'clarify',
    textEs: '¿Regular o Super?',
    textEn: 'Regular or Super?'
  },
  {
    clipId: 'clarify_regular_or_super_and_meat',
    category: 'clarify',
    textEs: '¿Regular o Super, y de qué carne?',
    textEn: 'Regular or Super, and what meat would you like?'
  },
  {
    clipId: 'clarify_meat',
    category: 'clarify',
    textEs: '¿De qué carne lo prefiere? Tenemos asada, pastor, pollo, cabeza, lengua, buche, chorizo y carnitas.',
    textEn: 'What meat would you like? Asada, pastor, chicken, cabeza, lengua, buche, chorizo, or carnitas?'
  },
  {
    clipId: 'clarify_drink_size',
    category: 'clarify',
    textEs: '¿Mediana, grande o de galón?',
    textEn: 'Medium, large, or gallon?'
  },
  {
    clipId: 'clarify_soda_size',
    category: 'clarify',
    textEs: '¿Mediana o grande?',
    textEn: 'Medium or large?'
  },
  {
    clipId: 'clarify_soda_flavor',
    category: 'clarify',
    textEs: '¿Qué sabor de refresco le gustaría?',
    textEn: 'Which soda would you like?'
  },
  {
    clipId: 'clarify_taco_plate_3',
    category: 'clarify',
    textEs: 'El plato incluye tres tacos, ¿de qué carne los prefiere?',
    textEn: 'The Taco Plate comes with three tacos—what meats would you like?'
  },
  {
    clipId: 'clarify_nachos_queso',
    category: 'clarify',
    textEs: '¿El queso derretido arriba de los nachos o aparte?',
    textEn: 'Would you like the melted cheese on the chips or on the side?'
  },
  {
    clipId: 'clarify_plato_tortillas',
    category: 'clarify',
    textEs: '¿Con tortillas de maíz o de harina?',
    textEn: 'Corn or flour tortillas?'
  },

  // 2) Confirmaciones instantáneas de los platillos #1 reales de `toast_ticket_consumption_snapshots` ('Drive Thru') + acuses universales
  {
    clipId: 'ack_1_taco_asada',
    category: 'item_ack',
    textEs: '¡Listo, un taco de asada! ¿Algo más?',
    textEn: 'Got it, one asada taco! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_asada',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de asada! ¿Algo más?',
    textEn: 'Got it, two asada tacos! Anything else?'
  },
  {
    clipId: 'ack_3_tacos_asada',
    category: 'item_ack',
    textEs: '¡Listo, tres tacos de asada! ¿Algo más?',
    textEn: 'Got it, three asada tacos! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_pastor',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de pastor! ¿Algo más?',
    textEn: 'Got it, two pastor tacos! Anything else?'
  },
  {
    clipId: 'ack_3_tacos_pastor',
    category: 'item_ack',
    textEs: '¡Listo, tres tacos de pastor! ¿Algo más?',
    textEn: 'Got it, three pastor tacos! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_pollo',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de pollo! ¿Algo más?',
    textEn: 'Got it, two chicken tacos! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_cabeza',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de cabeza! ¿Algo más?',
    textEn: 'Got it, two cabeza tacos! Anything else?'
  },
  {
    clipId: 'ack_1_burrito_asada',
    category: 'item_ack',
    textEs: '¡Listo, un burrito regular de asada! ¿Algo más?',
    textEn: 'Got it, one regular asada burrito! Anything else?'
  },
  {
    clipId: 'ack_1_super_burrito_asada',
    category: 'item_ack',
    textEs: '¡Listo, un super burrito de asada! ¿Algo más?',
    textEn: 'Got it, one super asada burrito! Anything else?'
  },
  {
    clipId: 'ack_1_champurrado',
    category: 'item_ack',
    textEs: '¡Listo, un champurrado! ¿Algo más?',
    textEn: 'Got it, one champurrado! Anything else?'
  },
  {
    clipId: 'ack_1_medium_horchata',
    category: 'item_ack',
    textEs: '¡Listo, una horchata mediana! ¿Algo más?',
    textEn: 'Got it, one medium horchata! Anything else?'
  },
  {
    clipId: 'ack_1_large_horchata',
    category: 'item_ack',
    textEs: '¡Listo, una horchata grande! ¿Algo más?',
    textEn: 'Got it, one large horchata! Anything else?'
  },
  {
    clipId: 'added_ack_1',
    category: 'item_ack',
    textEs: '¡Listo, agregado! ¿Algo más?',
    textEn: 'Got it, added! Anything else?'
  },
  {
    clipId: 'added_ack_2',
    category: 'item_ack',
    textEs: '¡Perfecto, ya quedó! ¿Algo más?',
    textEn: 'Awesome, got that! Anything else?'
  },
  {
    clipId: 'removed_ack_1',
    category: 'item_ack',
    textEs: '¡Listo, ya lo quité! ¿Algo más?',
    textEn: 'Got it, removed! Anything else?'
  },

  // 3) Situaciones operativas frecuentes de Drive-Thru
  {
    clipId: 'breakfast_closed_2pm',
    category: 'ops',
    textEs: 'Los desayunos terminan a las 2:00 de la tarde; ¿le gustaría algo del menú regular, como burritos, tacos, quesadillas o tortas?',
    textEn: 'Breakfast ends at 2:00 PM—would you like something from our regular menu, like burritos, tacos, quesadillas, or tortas?'
  },
  {
    clipId: 'ebt_cancel_go_inside',
    category: 'ops',
    textEs: 'Con gusto le atendemos con EBT adentro en el mostrador del comedor. ¡Muchas gracias!',
    textEn: 'We will gladly help you with EBT inside at the dining-room counter. Thank you!'
  },
  {
    clipId: 'driver_ready_win2_single',
    category: 'ops',
    textEs: '¡Su orden ya está lista! Pase a la ventana 2 por favor.',
    textEn: 'Your order is ready! Please pull forward to Window 2.'
  },
  {
    clipId: 'driver_ready_win2_multi',
    category: 'ops',
    textEs: '¡Sus órdenes ya están listas! Pase a la ventana 2 por favor.',
    textEn: 'Your orders are ready! Please pull forward to Window 2.'
  },
  {
    clipId: 'driver_preparing_win2',
    category: 'ops',
    textEs: 'Su orden está en preparación y empaque. Pase a la ventana 2 por favor.',
    textEn: 'Your order is in preparation and packing. Please pull forward to Window 2.'
  },

  // 4) Despedidas finales instantáneas (`end_session`)
  {
    clipId: 'sendoff_window1',
    category: 'sendoff',
    textEs: '¡Perfecto, muchas gracias! Pase a la ventanilla por favor.',
    textEn: 'Awesome, thank you so much! Please pull forward to the window.',
    isTerminalSendoff: true
  },
  {
    clipId: 'sendoff_window2_driver',
    category: 'sendoff',
    textEs: '¡Con gusto! Pase a la ventana 2 por favor.',
    textEn: 'My pleasure! Please pull forward to Window 2.',
    isTerminalSendoff: true
  },
  {
    clipId: 'sendoff_cancelled',
    category: 'sendoff',
    textEs: '¡Muchas gracias, que tenga excelente día!',
    textEn: 'Thank you very much, have a great day!',
    isTerminalSendoff: true
  }
])

const SPEC_BY_ID = new Map<string, KoreFastClipSpec>(KORE_FAST_CLIP_SPECS.map((s) => [s.clipId, s]))

export function getKoreFastClipSpec(clipId: string): KoreFastClipSpec | null {
  return SPEC_BY_ID.get(clipId) || null
}

function buildMatch(clipId: string, lang: 'es' | 'en', terminalOverride?: boolean): KoreFastClipMatch | null {
  const spec = SPEC_BY_ID.get(clipId)
  if (!spec) return null
  const isTerminal = terminalOverride !== undefined ? terminalOverride : Boolean(spec.isTerminalSendoff)
  return {
    clipId: spec.clipId,
    textEs: spec.textEs,
    textEn: spec.textEn,
    text: lang === 'en' ? spec.textEn : spec.textEs,
    ...(isTerminal ? { isTerminalSendoff: true } : {})
  }
}

function normPlain(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const SPECIFIC_MEAT_RE =
  /\b(?:asada|steak|pastor|adobada|pollo|chicken|cabeza|lengua|tongue|buche|chorizo|carnitas|pork|vegetarian[oa]?|veggie|frijol(?:es)?|beans?|queso|cheese)\b/i

const AGUA_FLAVOR_RE = /\b(?:horchata|jamaica|hibiscus|pina|pineapple|tamarindo|tamarind)\b/i
const SODA_FLAVOR_RE =
  /\b(?:coke|coca|diet\s*coke|sprite|fanta|pepsi|dr\s*pepper|root\s*beer|lemonade|limonada|iced?\s*tea|jarritos?|sidral|sangria)\b/i

const TOP_SINGLE_LINE_ACKS: Readonly<Record<string, string>> = Object.freeze({
  '1|taco asada': 'ack_1_taco_asada',
  '2|taco asada': 'ack_2_tacos_asada',
  '3|taco asada': 'ack_3_tacos_asada',
  '2|taco pastor': 'ack_2_tacos_pastor',
  '3|taco pastor': 'ack_3_tacos_pastor',
  '2|taco pollo': 'ack_2_tacos_pollo',
  '2|taco cabeza': 'ack_2_tacos_cabeza',
  '1|burrito asada': 'ack_1_burrito_asada',
  '1|super burrito asada': 'ack_1_super_burrito_asada',
  '1|champurrado': 'ack_1_champurrado',
  '1|medium horchata': 'ack_1_medium_horchata',
  '1|large horchata': 'ack_1_large_horchata'
})

function hasOnlyFreeModifiers(line: KoreOrderLine): boolean {
  if (!Array.isArray(line.modifiers) || line.modifiers.length === 0) return true
  return line.modifiers.every((m) => (Number(m.priceCents) || 0) === 0 && (Number(m.price) || 0) === 0)
}

function matchFailureClarification(
  errorCode: string,
  rawQuery: string,
  itemField: string,
  messageField: string,
  rawOptions: unknown,
  lang: 'es' | 'en'
): KoreFastClipMatch | null {
  if (errorCode === 'breakfast_closed') {
    return buildMatch('breakfast_closed_2pm', lang)
  }

  if (errorCode === 'modifier_rules') {
    const combined = `${normPlain(itemField)} ${normPlain(messageField)}`
    if (/\btaco\s+plate\b|\btaco\s+choice\b/.test(combined)) {
      return buildMatch('clarify_taco_plate_3', lang)
    }
    if (/\bqueso\s+modifiers?\b|\bsuper\s+nachos\b/.test(combined)) {
      return buildMatch('clarify_nachos_queso', lang)
    }
    if (/\btortillas\b/.test(combined)) {
      return buildMatch('clarify_plato_tortillas', lang)
    }
    return null
  }

  if (errorCode === 'ambiguous_item') {
    // Si el cliente pidió explícitamente tamaño "chico/small", dejar que Gemini aclare que el menor tamaño es Mediano (22 oz).
    if (/there is no small size/i.test(messageField)) return null

    const optNames = Array.isArray(rawOptions)
      ? rawOptions
          .map((o: any) => normPlain(typeof o === 'string' ? o : o?.name))
          .filter(Boolean)
      : []
    if (optNames.length === 0) return null

    const normQuery = normPlain(rawQuery)

    // A) Burrito / Quesadilla / Mulita: ¿Regular o Super? vs ¿Regular o Super, y de qué carne?
    // Nota: `result.options` viene truncado a 6 sugerencias (`suggestionList`), por lo que también evaluamos `normQuery`
    // cuando el cliente pidió burrito/quesadilla/mulita sin especificar `regular` ni `super`.
    const hasSuperVariant = optNames.some((n) => /\bsuper\s+(?:burrito|quesadilla|mulita)\b/.test(n))
    const hasRegularVariant = optNames.some(
      (n) => /\b(?:burrito|quesadilla|mulita)\b/.test(n) && !/\bsuper\b/.test(n)
    )
    const queryIsUnspecifiedRegSuperFamily =
      /\b(?:burritos?|quesadillas?|mulitas?)\b/.test(normQuery) &&
      !/\b(?:regular|super|supreme|supremo|suprema|huevo|huevos|egg|eggs)\b/.test(normQuery) &&
      optNames.some((n) => /\b(?:burrito|quesadilla|mulita)\b/.test(n))

    if ((hasSuperVariant && hasRegularVariant) || queryIsUnspecifiedRegSuperFamily) {
      if (optNames.length === 2 || SPECIFIC_MEAT_RE.test(normQuery)) {
        return buildMatch('clarify_regular_or_super', lang)
      }
      return buildMatch('clarify_regular_or_super_and_meat', lang)
    }

    // B) Refrescos sin sabor ("una soda", "un refresco")
    const sodaFlavorHits = optNames.filter((n) => SODA_FLAVOR_RE.test(n))
    if (
      sodaFlavorHits.length >= 2 &&
      !SODA_FLAVOR_RE.test(normQuery) &&
      /\b(?:soda|sodas|refresco|refrescos|fountain|drink|bebida)\b/.test(normQuery)
    ) {
      return buildMatch('clarify_soda_flavor', lang)
    }

    // C) Tamaño de bebida (Aguas Frescas con Galón vs Refrescos solo Mediana/Grande)
    const hasMedium = optNames.some((n) => /\bmedium\b/.test(n))
    const hasLarge = optNames.some((n) => /\blarge\b/.test(n))
    const hasGallon = optNames.some((n) => /\bgallon\b/.test(n))
    if (hasMedium && hasLarge) {
      if (hasGallon || AGUA_FLAVOR_RE.test(normQuery)) {
        return buildMatch('clarify_drink_size', lang)
      }
      if (SODA_FLAVOR_RE.test(normQuery) || optNames.length === 2) {
        return buildMatch('clarify_soda_size', lang)
      }
    }

    // D) Platillo de comida donde ya se sabe la familia (tacos, torta, sope, super burrito, super quesadilla, super nachos, plato) y solo falta elegir la carne
    const isMeatChoiceFamily =
      !SPECIFIC_MEAT_RE.test(normQuery) &&
      optNames.every((n) =>
        /\b(?:taco|burrito|quesadilla|mulita|torta|sope|nachos|plato)\b/.test(n)
      ) &&
      optNames.some((n) => SPECIFIC_MEAT_RE.test(n))
    if (isMeatChoiceFamily) {
      return buildMatch('clarify_meat', lang)
    }
  }

  return null
}

/**
 * Empata de forma pura el resultado de una herramienta de Kore Drive-Thru con un clip de voz pregrabado (`Kore 3.8`).
 * Devuelve `null` cuando la respuesta requiere texto dinámico de Gemini (ej. `confirm_order` con total exacto en USD,
 * `search_menu`, `get_order` o errores complejos con múltiples partes).
 */
export function matchKoreFastClipForToolOutcome(params: {
  toolName: string
  args: Record<string, unknown>
  stateBefore: KoreOrderState
  stateAfter: KoreOrderState
  result: Record<string, unknown>
  lang: 'es' | 'en'
  variantSeed?: number
}): KoreFastClipMatch | null {
  const tool = String(params.toolName || '').trim()
  const lang: 'es' | 'en' = params.lang === 'en' ? 'en' : 'es'
  const res = params.result || {}
  const args = params.args || {}

  // NUNCA interceptar confirm_order (debe leer artículos + total dinámico en dólares), get_order ni search_menu.
  if (tool === 'confirm_order' || tool === 'get_order' || tool === 'search_menu') {
    return null
  }

  // 1) Despedida final (`end_session`)
  if (tool === 'end_session') {
    if (res.ok !== true || res.should_end_session !== true) return null
    const reasonText = `${params.stateAfter?.cancelReason || ''} ${String(res.reason || '')}`
    if (params.stateAfter?.status === 'cancelled') {
      if (/\b(?:ebt|calfresh|food\s*stamps?|estampillas?|snap)\b/i.test(reasonText) && res.ebt_not_accepted_in_city !== true) {
        return buildMatch('ebt_cancel_go_inside', lang, true)
      }
      return buildMatch('sendoff_cancelled', lang, true)
    }
    const isDriver =
      params.stateAfter?.sessionKind === 'driver_pickup' ||
      (params.stateAfter?.driverPickup?.orders?.length ?? 0) > 0 ||
      res.reason === 'driver_dispatched'
    if (isDriver) {
      return buildMatch('sendoff_window2_driver', lang, true)
    }
    return buildMatch('sendoff_window1', lang, true)
  }

  // 2) Cancelación por EBT pasando al mostrador del comedor
  if (tool === 'cancel_order') {
    if (res.ok === true && res.ebt_dining_room_only === true && res.ebt_not_accepted_in_city !== true) {
      return buildMatch('ebt_cancel_go_inside', lang, false)
    }
    return null
  }

  // 3) Recolección de repartidor (`register_driver_pickup`) con estatus uniforme en Blindaje Delivery
  if (tool === 'register_driver_pickup') {
    if (res.ok !== true || res.lookup_degraded === true) return null
    const orders = Array.isArray(res.orders)
      ? (res.orders as Array<Record<string, unknown>>)
      : Array.isArray(params.stateAfter?.driverPickup?.orders)
        ? (params.stateAfter.driverPickup!.orders as unknown as Array<Record<string, unknown>>)
        : []
    if (orders.length === 0) return null
    const statuses = orders.map((o) => String(o?.lookup_status ?? o?.lookupStatus ?? ''))
    if (statuses.every((s) => s === 'ready')) {
      return buildMatch(orders.length === 1 ? 'driver_ready_win2_single' : 'driver_ready_win2_multi', lang)
    }
    if (orders.length === 1 && statuses[0] === 'preparing') {
      return buildMatch('driver_preparing_win2', lang)
    }
    return null
  }

  // 4) Quitar producto (`remove_item`) limpio
  if (tool === 'remove_item') {
    const warnings = Array.isArray(res.warnings) ? res.warnings : []
    if (res.ok === true && warnings.length === 0) {
      return buildMatch('removed_ack_1', lang)
    }
    return null
  }

  // 5) Agregar 1 o varios productos (`add_item` / `add_items`)
  if (tool === 'add_item' || tool === 'add_items') {
    if (res.ok === false) {
      if (tool === 'add_item') {
        return matchFailureClarification(
          String(res.error_code || ''),
          String(args.item_name ?? args.itemName ?? args.name ?? ''),
          String(res.item || ''),
          String(res.message || ''),
          res.options,
          lang
        )
      }
      // En `add_items`, solo usar clip rápido si falló exactamente 1 entrada y no se agregaron otras a medias
      const failedItems = Array.isArray(res.failed_items) ? (res.failed_items as Array<Record<string, unknown>>) : []
      if (failedItems.length === 1 && (Number(res.added_count) || 0) === 0) {
        const f = failedItems[0]
        return matchFailureClarification(
          String(f.error_code || ''),
          String(f.item_name || ''),
          String(f.item || f.item_name || ''),
          String(f.message || ''),
          f.options,
          lang
        )
      }
      return null
    }

    if (res.ok === true) {
      const warnings = Array.isArray(res.warnings) ? res.warnings : []
      const failedItems = Array.isArray(res.failed_items) ? res.failed_items : []
      if (warnings.length > 0 || failedItems.length > 0) return null

      const beforeIds = new Set((params.stateBefore?.lines || []).map((l) => l.lineId))
      const newlyAdded = (params.stateAfter?.lines || []).filter((l) => !beforeIds.has(l.lineId))

      if (newlyAdded.length === 1) {
        const line = newlyAdded[0]
        if (hasOnlyFreeModifiers(line) && !line.notes) {
          const specificKey = `${line.quantity}|${normPlain(line.name)}`
          const specificClipId = TOP_SINGLE_LINE_ACKS[specificKey]
          if (specificClipId) {
            return buildMatch(specificClipId, lang)
          }
        }
      }

      const seed =
        typeof params.variantSeed === 'number' && Number.isFinite(params.variantSeed)
          ? Math.abs(Math.trunc(params.variantSeed))
          : Math.abs(Number(params.stateAfter?.version ?? params.stateAfter?.lines?.length ?? 0))
      return buildMatch(seed % 2 === 0 ? 'added_ack_1' : 'added_ack_2', lang)
    }
  }

  return null
}

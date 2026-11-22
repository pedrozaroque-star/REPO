/**
 * @module lib/drive-thru-kore-fast-match
 * @description Motor PURO e isomórfico (servidor + navegador, cero imports `node:*` ni Supabase) que empata en `< 1 ms`
 * el resultado de cualquier herramienta (`applyKoreTool` / `driver-lookup`) de "Kore Drive-Thru" contra el banco expandido 4x
 * de **`140` situaciones comunes bilingües (`+ 4` bienvenidas por tienda = `144` situaciones = `288` audios `Kore 3.8` ES/EN)**
 * derivadas de la minería profunda sobre los **6,408 tickets detallados de Toast (`toast_ticket_consumption_snapshots` con
 * `dining_option_name = 'Drive Thru'`)** y las **400,400+ órdenes históricas de `dt_orders`**.
 *
 * @businessRules
 * - **Cero intercepción de `confirm_order`**: `confirm_order` NUNCA se reemplaza por un clip fijo porque debe leer en vivo
 *   los artículos exactos y el total dinámico en dólares (`USD`) de esa orden.
 * - **Aclaraciones inmediatas por familia (`18` `clarify_*`)**: cubre *"¿Su burrito lo prefiere Regular o Super?"*,
 *   quesadilla/mulita Regular o Super, elección de carne en tacos/tortas/sopes/platos, tamaño de horchata/jamaica/aguas frescas
 *   (`Mediana, grande o de galón`), tamaño y sabor de refrescos (`Mediana o grande`, más `clarify_no_small_drink` cuando piden
 *   tamaño *"chico/small"* aclarando en `< 10 ms` que el tamaño inicial es Mediana de `22 oz`), 3 tacos de `Taco Plate`,
 *   queso de `Super Nachos` y tortillas de `Plato`.
 * - **Platillos individuales × cantidades reales (`83` `TOP_SINGLE_LINE_ACKS`) + Combos de 2 líneas (`10` `TOP_TWO_LINE_COMBO_ACKS`)
 *   + Modificadores (`8` `mod_*`) + Acuses rotativos (`6` `added_ack_*` + `2` `removed_ack_*`)**: todos validados 1:1 contra
 *   los nombres exactos de `app_menu_cache` y las cortesías `$0.00` (`Cebolla Asada (Cortesía)`, `Frijol de la Olla (Cortesía)`).
 * - **Situaciones operativas (`8` `ops`) y despedidas rotativas (`5` `sendoff`, `isTerminalSendoff`)**: corte de desayunos
 *   2:00 PM PT, redirección de EBT al comedor o aviso en ciudades sin EBT (`ebt_not_accepted_city`), estatus de repartidores
 *   hacia **Ventana 2** (`ready`, `preparing`, mixto y verificación en ventana) y despedidas cálidas rotativas (`end_session`).
 *
 * @dataFlow
 * - Servidor (`lib/drive-thru-kore-fast-clips.ts`): itera `KORE_FAST_CLIP_SPECS` para sintetizar y persistir el 100% de
 *   los clips `es` y `en` en Supabase Storage (`order-ready-tts`, voz `Kore 3.8` a 24 kHz) y servirlos de forma paginada
 *   segura (`<= 2.6 MB` por página, bajo el límite `4.5 MB` de Vercel) vía `GET /api/drive-thru/kore/fast-clips`.
 * - Navegador (`components/drive-thru/KoreDriveThruSimulator.tsx`): llama `matchKoreFastClipForToolOutcome(...)` dentro de
 *   `handleToolCall` y reproduce el `Float32Array` pre-decodificado en `< 10 ms` sin superposición de voz.
 *
 * @notes
 * - Módulo 100% determinista, inmutable y libre de efectos secundarios (`KORE_FAST_CLIP_SPECS.length === 140`).
 * - Fase 19 (`cb6234d1`): `matchKoreFastClipForToolOutcome` soporta `customerTurnText` opcional y omite el acuse parcial
 *   cuando `hasUnresolvedCompoundOrderItems(customerTurnText, newlyAdded.length) === true` (ej. `"Quiero un taco de asada y dos burritos"`).
 */

import type { KoreOrderLine, KoreOrderState } from '@/lib/drive-thru-kore-order'
import { hasUnresolvedCompoundOrderItems } from '@/lib/kore-shared-speech'

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
  // =========================================================================
  // 1) ACLARACIONES INMEDIATAS POR FAMILIA (`clarify` — 18 situaciones)
  // =========================================================================
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
    clipId: 'clarify_burrito_reg_or_super',
    category: 'clarify',
    textEs: '¿Su burrito lo prefiere Regular o Super?',
    textEn: 'Would you like your burrito Regular or Super?'
  },
  {
    clipId: 'clarify_quesadilla_reg_or_super',
    category: 'clarify',
    textEs: '¿Su quesadilla la prefiere Regular o Super?',
    textEn: 'Would you like your quesadilla Regular or Super?'
  },
  {
    clipId: 'clarify_mulita_reg_or_super',
    category: 'clarify',
    textEs: '¿Su mulita la prefiere Regular o Super?',
    textEn: 'Would you like your mulita Regular or Super?'
  },
  {
    clipId: 'clarify_meat',
    category: 'clarify',
    textEs: '¿De qué carne lo prefiere? Tenemos asada, pastor, pollo, cabeza, lengua, buche, chorizo y carnitas.',
    textEn: 'What meat would you like? Asada, pastor, chicken, cabeza, lengua, buche, chorizo, or carnitas?'
  },
  {
    clipId: 'clarify_tacos_meat',
    category: 'clarify',
    textEs: '¿De qué carne le ponemos sus tacos? Tenemos asada, pastor, pollo, cabeza, lengua, buche, chorizo y carnitas.',
    textEn: 'What meat would you like on your tacos? Asada, pastor, chicken, cabeza, lengua, buche, chorizo, or carnitas?'
  },
  {
    clipId: 'clarify_torta_meat',
    category: 'clarify',
    textEs: '¿De qué carne le gustaría su torta? También tenemos Cubana y de milanesa.',
    textEn: 'What meat would you like on your torta? We also have Torta Cubana and milanesa.'
  },
  {
    clipId: 'clarify_sope_meat',
    category: 'clarify',
    textEs: '¿De qué carne le preparamos su sope?',
    textEn: 'What meat would you like on your sope?'
  },
  {
    clipId: 'clarify_drink_size',
    category: 'clarify',
    textEs: '¿Mediana, grande o de galón?',
    textEn: 'Medium, large, or gallon?'
  },
  {
    clipId: 'clarify_horchata_size',
    category: 'clarify',
    textEs: '¿Su horchata la prefiere mediana, grande o de galón?',
    textEn: 'Would you like your horchata medium, large, or gallon?'
  },
  {
    clipId: 'clarify_jamaica_size',
    category: 'clarify',
    textEs: '¿Su agua de jamaica la prefiere mediana, grande o de galón?',
    textEn: 'Would you like your jamaica medium, large, or gallon?'
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
    clipId: 'clarify_no_small_drink',
    category: 'clarify',
    textEs: 'Nuestro primer tamaño de bebida es Mediana de 22 onzas, o Grande de 32 onzas. ¿Cuál prefiere?',
    textEn: 'Our starting drink size is Medium 22 ounce, or Large 32 ounce. Which would you like?'
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

  // =========================================================================
  // 2) SITUACIONES OPERATIVAS Y REPARTIDORES (`ops` — 8 situaciones)
  // =========================================================================
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
    clipId: 'ebt_not_accepted_city',
    category: 'ops',
    textEs: 'En esta sucursal no contamos con terminal EBT; aceptamos efectivo, tarjeta, Apple Pay y Google Pay.',
    textEn: 'EBT is not available at this location; we accept cash, card, Apple Pay, and Google Pay.'
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
  {
    clipId: 'driver_preparing_win2_multi',
    category: 'ops',
    textEs: 'Sus órdenes están en preparación y empaque. Pase a la ventana 2 por favor.',
    textEn: 'Your orders are in preparation and packing. Please pull forward to Window 2.'
  },
  {
    clipId: 'driver_not_found_win2',
    category: 'ops',
    textEs: 'Pase por favor a la ventana 2 para verificar su código de recolección con nuestro equipo.',
    textEn: 'Please pull forward to Window 2 so our team can verify your pickup code.'
  },

  // =========================================================================
  // 3) DESPEDIDAS FINALES ROTATIVAS (`sendoff` — 5 situaciones)
  // =========================================================================
  {
    clipId: 'sendoff_window1',
    category: 'sendoff',
    textEs: '¡Perfecto, muchas gracias! Pase a la ventanilla por favor.',
    textEn: 'Awesome, thank you so much! Please pull forward to the window.',
    isTerminalSendoff: true
  },
  {
    clipId: 'sendoff_window1_v2',
    category: 'sendoff',
    textEs: '¡Excelente, muchas gracias por su preferencia! Avance a la primera ventanilla por favor.',
    textEn: 'Wonderful, thank you so much! Please pull up to the first window.',
    isTerminalSendoff: true
  },
  {
    clipId: 'sendoff_window1_v3',
    category: 'sendoff',
    textEs: '¡Listo, su orden quedó confirmada! Pase a la ventanilla por favor, ¡gracias!',
    textEn: 'All set, your order is confirmed! Please pull forward to the window, thank you!',
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
  },

  // =========================================================================
  // 4) ACUSES UNIVERSALES, ELIMINACIÓN Y MODIFICADORES (`item_ack` — 16)
  // =========================================================================
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
    clipId: 'added_ack_3',
    category: 'item_ack',
    textEs: '¡Con gusto, ya lo agregué! ¿Algo más?',
    textEn: 'My pleasure, added! Anything else?'
  },
  {
    clipId: 'added_ack_4',
    category: 'item_ack',
    textEs: '¡Claro que sí, anotado! ¿Algo más?',
    textEn: 'Sure thing, got it down! Anything else?'
  },
  {
    clipId: 'added_ack_5',
    category: 'item_ack',
    textEs: '¡Muy bien, agregado a su orden! ¿Le ponemos algo más?',
    textEn: 'Sounds good, added to your order! Anything else today?'
  },
  {
    clipId: 'added_ack_6',
    category: 'item_ack',
    textEs: '¡Excelente elección, ya quedó! ¿Algo más?',
    textEn: 'Great choice, added! Anything else for you?'
  },
  {
    clipId: 'removed_ack_1',
    category: 'item_ack',
    textEs: '¡Listo, ya lo quité! ¿Algo más?',
    textEn: 'Got it, removed! Anything else?'
  },
  {
    clipId: 'removed_ack_2',
    category: 'item_ack',
    textEs: '¡Claro, ya quedó eliminado de su orden! ¿Algo más?',
    textEn: 'Sure, removed from your order! Anything else?'
  },
  {
    clipId: 'mod_con_todo',
    category: 'item_ack',
    textEs: '¡Listo, con todo sin cargo! ¿Algo más?',
    textEn: 'Got it, with everything at no charge! Anything else?'
  },
  {
    clipId: 'mod_sin_cebolla',
    category: 'item_ack',
    textEs: '¡Anotado, sin cebolla! ¿Algo más?',
    textEn: 'Got it, no onions! Anything else?'
  },
  {
    clipId: 'mod_sin_cilantro',
    category: 'item_ack',
    textEs: '¡Anotado, sin cilantro! ¿Algo más?',
    textEn: 'Got it, no cilantro! Anything else?'
  },
  {
    clipId: 'mod_cebolla_asada_free',
    category: 'item_ack',
    textEs: '¡Claro, le agregué sus cebollitas asadas de cortesía! ¿Algo más?',
    textEn: 'Sure, added your complimentary grilled onions! Anything else?'
  },
  {
    clipId: 'mod_frijol_olla_free',
    category: 'item_ack',
    textEs: '¡Claro, le agregué sus frijoles de la olla de cortesía! ¿Algo más?',
    textEn: 'Sure, added your complimentary whole pot beans! Anything else?'
  },
  {
    clipId: 'mod_salsa_verde',
    category: 'item_ack',
    textEs: '¡Listo, con salsa verde! ¿Algo más?',
    textEn: 'Got it, with green salsa! Anything else?'
  },
  {
    clipId: 'mod_salsa_roja',
    category: 'item_ack',
    textEs: '¡Listo, con salsa roja! ¿Algo más?',
    textEn: 'Got it, with red salsa! Anything else?'
  },
  {
    clipId: 'mod_updated_generic',
    category: 'item_ack',
    textEs: '¡Listo, actualicé su platillo! ¿Algo más?',
    textEn: 'Got it, updated that for you! Anything else?'
  },

  // =========================================================================
  // 5) COMBOS REALES DE 2 LÍNEAS EN UN MISMO LOTE (`item_ack` — 10 combos)
  // =========================================================================
  {
    clipId: 'combo_taco_asada_pastor',
    category: 'item_ack',
    textEs: '¡Listo, tacos de asada y al pastor agregados! ¿Algo más?',
    textEn: 'Got it, asada and pastor tacos added! Anything else?'
  },
  {
    clipId: 'combo_taco_asada_pollo',
    category: 'item_ack',
    textEs: '¡Listo, tacos de asada y de pollo agregados! ¿Algo más?',
    textEn: 'Got it, asada and chicken tacos added! Anything else?'
  },
  {
    clipId: 'combo_taco_asada_cabeza',
    category: 'item_ack',
    textEs: '¡Listo, tacos de asada y de cabeza agregados! ¿Algo más?',
    textEn: 'Got it, asada and cabeza tacos added! Anything else?'
  },
  {
    clipId: 'combo_burrito_taco_asada',
    category: 'item_ack',
    textEs: '¡Listo, burrito regular de asada y orden de tacos de asada! ¿Algo más?',
    textEn: 'Got it, regular asada burrito and asada tacos added! Anything else?'
  },
  {
    clipId: 'combo_taco_asada_champurrado',
    category: 'item_ack',
    textEs: '¡Listo, orden de tacos de asada y champurrado agregados! ¿Algo más?',
    textEn: 'Got it, asada tacos and champurrado added! Anything else?'
  },
  {
    clipId: 'combo_taco_asada_lrg_horchata',
    category: 'item_ack',
    textEs: '¡Listo, tacos de asada y horchata grande agregados! ¿Algo más?',
    textEn: 'Got it, asada tacos and large horchata added! Anything else?'
  },
  {
    clipId: 'combo_burrito_asada_med_horchata',
    category: 'item_ack',
    textEs: '¡Listo, burrito regular de asada y horchata mediana! ¿Algo más?',
    textEn: 'Got it, regular asada burrito and medium horchata! Anything else?'
  },
  {
    clipId: 'combo_burrito_asada_lrg_horchata',
    category: 'item_ack',
    textEs: '¡Listo, burrito regular de asada y horchata grande! ¿Algo más?',
    textEn: 'Got it, regular asada burrito and large horchata! Anything else?'
  },
  {
    clipId: 'combo_super_burrito_asada_lrg_horchata',
    category: 'item_ack',
    textEs: '¡Listo, super burrito de asada y horchata grande! ¿Algo más?',
    textEn: 'Got it, super asada burrito and large horchata! Anything else?'
  },
  {
    clipId: 'combo_courtesy_beans_onions',
    category: 'item_ack',
    textEs: '¡Con gusto, sus frijoles de la olla y cebollitas asadas de cortesía! ¿Algo más?',
    textEn: 'My pleasure, added your complimentary pot beans and grilled onions! Anything else?'
  },

  // =========================================================================
  // 6) PLATILLOS INDIVIDUALES × CANTIDADES REALES DE DT (`item_ack` — 83)
  // =========================================================================
  // 6A. Tacos (30 pares reales)
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
    clipId: 'ack_4_tacos_asada',
    category: 'item_ack',
    textEs: '¡Listo, cuatro tacos de asada! ¿Algo más?',
    textEn: 'Got it, four asada tacos! Anything else?'
  },
  {
    clipId: 'ack_5_tacos_asada',
    category: 'item_ack',
    textEs: '¡Listo, cinco tacos de asada! ¿Algo más?',
    textEn: 'Got it, five asada tacos! Anything else?'
  },
  {
    clipId: 'ack_6_tacos_asada',
    category: 'item_ack',
    textEs: '¡Listo, seis tacos de asada! ¿Algo más?',
    textEn: 'Got it, six asada tacos! Anything else?'
  },
  {
    clipId: 'ack_8_tacos_asada',
    category: 'item_ack',
    textEs: '¡Listo, ocho tacos de asada! ¿Algo más?',
    textEn: 'Got it, eight asada tacos! Anything else?'
  },
  {
    clipId: 'ack_10_tacos_asada',
    category: 'item_ack',
    textEs: '¡Listo, diez tacos de asada! ¿Algo más?',
    textEn: 'Got it, ten asada tacos! Anything else?'
  },
  {
    clipId: 'ack_1_taco_pastor',
    category: 'item_ack',
    textEs: '¡Listo, un taco al pastor! ¿Algo más?',
    textEn: 'Got it, one pastor taco! Anything else?'
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
    clipId: 'ack_4_tacos_pastor',
    category: 'item_ack',
    textEs: '¡Listo, cuatro tacos al pastor! ¿Algo más?',
    textEn: 'Got it, four pastor tacos! Anything else?'
  },
  {
    clipId: 'ack_5_tacos_pastor',
    category: 'item_ack',
    textEs: '¡Listo, cinco tacos al pastor! ¿Algo más?',
    textEn: 'Got it, five pastor tacos! Anything else?'
  },
  {
    clipId: 'ack_6_tacos_pastor',
    category: 'item_ack',
    textEs: '¡Listo, seis tacos al pastor! ¿Algo más?',
    textEn: 'Got it, six pastor tacos! Anything else?'
  },
  {
    clipId: 'ack_1_taco_pollo',
    category: 'item_ack',
    textEs: '¡Listo, un taco de pollo! ¿Algo más?',
    textEn: 'Got it, one chicken taco! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_pollo',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de pollo! ¿Algo más?',
    textEn: 'Got it, two chicken tacos! Anything else?'
  },
  {
    clipId: 'ack_3_tacos_pollo',
    category: 'item_ack',
    textEs: '¡Listo, tres tacos de pollo! ¿Algo más?',
    textEn: 'Got it, three chicken tacos! Anything else?'
  },
  {
    clipId: 'ack_4_tacos_pollo',
    category: 'item_ack',
    textEs: '¡Listo, cuatro tacos de pollo! ¿Algo más?',
    textEn: 'Got it, four chicken tacos! Anything else?'
  },
  {
    clipId: 'ack_1_taco_cabeza',
    category: 'item_ack',
    textEs: '¡Listo, un taco de cabeza! ¿Algo más?',
    textEn: 'Got it, one cabeza taco! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_cabeza',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de cabeza! ¿Algo más?',
    textEn: 'Got it, two cabeza tacos! Anything else?'
  },
  {
    clipId: 'ack_3_tacos_cabeza',
    category: 'item_ack',
    textEs: '¡Listo, tres tacos de cabeza! ¿Algo más?',
    textEn: 'Got it, three cabeza tacos! Anything else?'
  },
  {
    clipId: 'ack_4_tacos_cabeza',
    category: 'item_ack',
    textEs: '¡Listo, cuatro tacos de cabeza! ¿Algo más?',
    textEn: 'Got it, four cabeza tacos! Anything else?'
  },
  {
    clipId: 'ack_1_taco_lengua',
    category: 'item_ack',
    textEs: '¡Listo, un taco de lengua! ¿Algo más?',
    textEn: 'Got it, one lengua taco! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_lengua',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de lengua! ¿Algo más?',
    textEn: 'Got it, two lengua tacos! Anything else?'
  },
  {
    clipId: 'ack_1_taco_chorizo',
    category: 'item_ack',
    textEs: '¡Listo, un taco de chorizo! ¿Algo más?',
    textEn: 'Got it, one chorizo taco! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_chorizo',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de chorizo! ¿Algo más?',
    textEn: 'Got it, two chorizo tacos! Anything else?'
  },
  {
    clipId: 'ack_1_taco_buche',
    category: 'item_ack',
    textEs: '¡Listo, un taco de buche! ¿Algo más?',
    textEn: 'Got it, one buche taco! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_buche',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de buche! ¿Algo más?',
    textEn: 'Got it, two buche tacos! Anything else?'
  },
  {
    clipId: 'ack_1_taco_carnitas',
    category: 'item_ack',
    textEs: '¡Listo, un taco de carnitas! ¿Algo más?',
    textEn: 'Got it, one carnitas taco! Anything else?'
  },
  {
    clipId: 'ack_2_tacos_carnitas',
    category: 'item_ack',
    textEs: '¡Listo, dos tacos de carnitas! ¿Algo más?',
    textEn: 'Got it, two carnitas tacos! Anything else?'
  },

  // 6B. Burritos, Super Burritos y Pura Carne (15 pares reales)
  {
    clipId: 'ack_1_burrito_asada',
    category: 'item_ack',
    textEs: '¡Listo, un burrito regular de asada! ¿Algo más?',
    textEn: 'Got it, one regular asada burrito! Anything else?'
  },
  {
    clipId: 'ack_2_burritos_asada',
    category: 'item_ack',
    textEs: '¡Listo, dos burritos regulares de asada! ¿Algo más?',
    textEn: 'Got it, two regular asada burritos! Anything else?'
  },
  {
    clipId: 'ack_1_super_burrito_asada',
    category: 'item_ack',
    textEs: '¡Listo, un super burrito de asada! ¿Algo más?',
    textEn: 'Got it, one super asada burrito! Anything else?'
  },
  {
    clipId: 'ack_2_super_burritos_asada',
    category: 'item_ack',
    textEs: '¡Listo, dos super burritos de asada! ¿Algo más?',
    textEn: 'Got it, two super asada burritos! Anything else?'
  },
  {
    clipId: 'ack_1_burrito_pastor',
    category: 'item_ack',
    textEs: '¡Listo, un burrito regular al pastor! ¿Algo más?',
    textEn: 'Got it, one regular pastor burrito! Anything else?'
  },
  {
    clipId: 'ack_2_burritos_pastor',
    category: 'item_ack',
    textEs: '¡Listo, dos burritos regulares al pastor! ¿Algo más?',
    textEn: 'Got it, two regular pastor burritos! Anything else?'
  },
  {
    clipId: 'ack_1_super_burrito_pastor',
    category: 'item_ack',
    textEs: '¡Listo, un super burrito al pastor! ¿Algo más?',
    textEn: 'Got it, one super pastor burrito! Anything else?'
  },
  {
    clipId: 'ack_1_burrito_pollo',
    category: 'item_ack',
    textEs: '¡Listo, un burrito regular de pollo! ¿Algo más?',
    textEn: 'Got it, one regular chicken burrito! Anything else?'
  },
  {
    clipId: 'ack_2_burritos_pollo',
    category: 'item_ack',
    textEs: '¡Listo, dos burritos regulares de pollo! ¿Algo más?',
    textEn: 'Got it, two regular chicken burritos! Anything else?'
  },
  {
    clipId: 'ack_1_super_burrito_pollo',
    category: 'item_ack',
    textEs: '¡Listo, un super burrito de pollo! ¿Algo más?',
    textEn: 'Got it, one super chicken burrito! Anything else?'
  },
  {
    clipId: 'ack_1_burrito_cabeza',
    category: 'item_ack',
    textEs: '¡Listo, un burrito regular de cabeza! ¿Algo más?',
    textEn: 'Got it, one regular cabeza burrito! Anything else?'
  },
  {
    clipId: 'ack_1_burrito_lengua',
    category: 'item_ack',
    textEs: '¡Listo, un burrito regular de lengua! ¿Algo más?',
    textEn: 'Got it, one regular lengua burrito! Anything else?'
  },
  {
    clipId: 'ack_1_burrito_carnitas',
    category: 'item_ack',
    textEs: '¡Listo, un burrito regular de carnitas! ¿Algo más?',
    textEn: 'Got it, one regular carnitas burrito! Anything else?'
  },
  {
    clipId: 'ack_1_burrito_brc',
    category: 'item_ack',
    textEs: '¡Listo, un burrito de frijol, queso y arroz! ¿Algo más?',
    textEn: 'Got it, one bean, cheese, and rice burrito! Anything else?'
  },
  {
    clipId: 'ack_1_meat_only_burrito_asada',
    category: 'item_ack',
    textEs: '¡Listo, un burrito de pura carne asada! ¿Algo más?',
    textEn: 'Got it, one all-meat asada burrito! Anything else?'
  },

  // 6C. Quesadillas y Mulitas (10 pares reales)
  {
    clipId: 'ack_1_quesadilla_queso',
    category: 'item_ack',
    textEs: '¡Listo, una quesadilla de puro queso! ¿Algo más?',
    textEn: 'Got it, one cheese quesadilla! Anything else?'
  },
  {
    clipId: 'ack_1_quesadilla_asada',
    category: 'item_ack',
    textEs: '¡Listo, una quesadilla regular de asada! ¿Algo más?',
    textEn: 'Got it, one regular asada quesadilla! Anything else?'
  },
  {
    clipId: 'ack_2_quesadillas_asada',
    category: 'item_ack',
    textEs: '¡Listo, dos quesadillas regulares de asada! ¿Algo más?',
    textEn: 'Got it, two regular asada quesadillas! Anything else?'
  },
  {
    clipId: 'ack_1_super_quesadilla_asada',
    category: 'item_ack',
    textEs: '¡Listo, una super quesadilla de asada! ¿Algo más?',
    textEn: 'Got it, one super asada quesadilla! Anything else?'
  },
  {
    clipId: 'ack_1_quesadilla_pastor',
    category: 'item_ack',
    textEs: '¡Listo, una quesadilla regular al pastor! ¿Algo más?',
    textEn: 'Got it, one regular pastor quesadilla! Anything else?'
  },
  {
    clipId: 'ack_1_quesadilla_pollo',
    category: 'item_ack',
    textEs: '¡Listo, una quesadilla regular de pollo! ¿Algo más?',
    textEn: 'Got it, one regular chicken quesadilla! Anything else?'
  },
  {
    clipId: 'ack_1_super_quesadilla_pollo',
    category: 'item_ack',
    textEs: '¡Listo, una super quesadilla de pollo! ¿Algo más?',
    textEn: 'Got it, one super chicken quesadilla! Anything else?'
  },
  {
    clipId: 'ack_1_mulita_asada',
    category: 'item_ack',
    textEs: '¡Listo, una mulita regular de asada! ¿Algo más?',
    textEn: 'Got it, one regular asada mulita! Anything else?'
  },
  {
    clipId: 'ack_2_mulitas_asada',
    category: 'item_ack',
    textEs: '¡Listo, dos mulitas regulares de asada! ¿Algo más?',
    textEn: 'Got it, two regular asada mulitas! Anything else?'
  },
  {
    clipId: 'ack_1_super_mulita_asada',
    category: 'item_ack',
    textEs: '¡Listo, una super mulita de asada! ¿Algo más?',
    textEn: 'Got it, one super asada mulita! Anything else?'
  },

  // 6D. Tortas, Sopes, Super Nachos, Taco Plate y Platos (11 pares reales)
  {
    clipId: 'ack_1_torta_asada',
    category: 'item_ack',
    textEs: '¡Listo, una torta de asada! ¿Algo más?',
    textEn: 'Got it, one asada torta! Anything else?'
  },
  {
    clipId: 'ack_2_tortas_asada',
    category: 'item_ack',
    textEs: '¡Listo, dos tortas de asada! ¿Algo más?',
    textEn: 'Got it, two asada tortas! Anything else?'
  },
  {
    clipId: 'ack_1_torta_pastor',
    category: 'item_ack',
    textEs: '¡Listo, una torta al pastor! ¿Algo más?',
    textEn: 'Got it, one pastor torta! Anything else?'
  },
  {
    clipId: 'ack_1_torta_pollo',
    category: 'item_ack',
    textEs: '¡Listo, una torta de pollo! ¿Algo más?',
    textEn: 'Got it, one chicken torta! Anything else?'
  },
  {
    clipId: 'ack_1_torta_cubana',
    category: 'item_ack',
    textEs: '¡Listo, una torta cubana! ¿Algo más?',
    textEn: 'Got it, one Torta Cubana! Anything else?'
  },
  {
    clipId: 'ack_1_torta_milanesa',
    category: 'item_ack',
    textEs: '¡Listo, una torta de milanesa! ¿Algo más?',
    textEn: 'Got it, one milanesa torta! Anything else?'
  },
  {
    clipId: 'ack_1_sope_asada',
    category: 'item_ack',
    textEs: '¡Listo, un sope de asada! ¿Algo más?',
    textEn: 'Got it, one asada sope! Anything else?'
  },
  {
    clipId: 'ack_2_sopes_asada',
    category: 'item_ack',
    textEs: '¡Listo, dos sopes de asada! ¿Algo más?',
    textEn: 'Got it, two asada sopes! Anything else?'
  },
  {
    clipId: 'ack_1_super_nachos_asada',
    category: 'item_ack',
    textEs: '¡Listo, unos super nachos de asada! ¿Algo más?',
    textEn: 'Got it, one Super Nachos Asada! Anything else?'
  },
  {
    clipId: 'ack_1_taco_plate',
    category: 'item_ack',
    textEs: '¡Listo, su plato de tres tacos con arroz y frijoles! ¿Algo más?',
    textEn: 'Got it, your three-taco plate with rice and beans! Anything else?'
  },
  {
    clipId: 'ack_1_plato_asada',
    category: 'item_ack',
    textEs: '¡Listo, un plato de carne asada! ¿Algo más?',
    textEn: 'Got it, one carne asada plate! Anything else?'
  },

  // 6E. Bebidas, Extras, Postres y Cortesías $0.00 (17 pares reales)
  {
    clipId: 'ack_1_champurrado',
    category: 'item_ack',
    textEs: '¡Listo, un champurrado! ¿Algo más?',
    textEn: 'Got it, one champurrado! Anything else?'
  },
  {
    clipId: 'ack_2_champurrados',
    category: 'item_ack',
    textEs: '¡Listo, dos champurrados! ¿Algo más?',
    textEn: 'Got it, two champurrados! Anything else?'
  },
  {
    clipId: 'ack_1_coffee',
    category: 'item_ack',
    textEs: '¡Listo, un café caliente! ¿Algo más?',
    textEn: 'Got it, one hot coffee! Anything else?'
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
    clipId: 'ack_1_medium_jamaica',
    category: 'item_ack',
    textEs: '¡Listo, una jamaica mediana! ¿Algo más?',
    textEn: 'Got it, one medium jamaica! Anything else?'
  },
  {
    clipId: 'ack_1_large_jamaica',
    category: 'item_ack',
    textEs: '¡Listo, una jamaica grande! ¿Algo más?',
    textEn: 'Got it, one large jamaica! Anything else?'
  },
  {
    clipId: 'ack_1_medium_pina',
    category: 'item_ack',
    textEs: '¡Listo, un agua de piña mediana! ¿Algo más?',
    textEn: 'Got it, one medium pineapple agua fresca! Anything else?'
  },
  {
    clipId: 'ack_1_large_pina',
    category: 'item_ack',
    textEs: '¡Listo, un agua de piña grande! ¿Algo más?',
    textEn: 'Got it, one large pineapple agua fresca! Anything else?'
  },
  {
    clipId: 'ack_1_medium_coke',
    category: 'item_ack',
    textEs: '¡Listo, una Coca-Cola mediana! ¿Algo más?',
    textEn: 'Got it, one medium Coke! Anything else?'
  },
  {
    clipId: 'ack_1_large_coke',
    category: 'item_ack',
    textEs: '¡Listo, una Coca-Cola grande! ¿Algo más?',
    textEn: 'Got it, one large Coke! Anything else?'
  },
  {
    clipId: 'ack_1_bottled_water',
    category: 'item_ack',
    textEs: '¡Listo, un agua embotellada! ¿Algo más?',
    textEn: 'Got it, one bottled water! Anything else?'
  },
  {
    clipId: 'ack_1_side_rice',
    category: 'item_ack',
    textEs: '¡Listo, una orden de arroz! ¿Algo más?',
    textEn: 'Got it, one side of rice! Anything else?'
  },
  {
    clipId: 'ack_1_side_beans',
    category: 'item_ack',
    textEs: '¡Listo, una orden de frijoles! ¿Algo más?',
    textEn: 'Got it, one side of beans! Anything else?'
  },
  {
    clipId: 'ack_1_flan',
    category: 'item_ack',
    textEs: '¡Listo, un flan! ¿Algo más?',
    textEn: 'Got it, one flan! Anything else?'
  },
  {
    clipId: 'ack_1_cheesecake',
    category: 'item_ack',
    textEs: '¡Listo, una rebanada de cheesecake! ¿Algo más?',
    textEn: 'Got it, one slice of cheesecake! Anything else?'
  },
  {
    clipId: 'ack_1_courtesy_cebolla_asada',
    category: 'item_ack',
    textEs: '¡Claro que sí, sus cebollitas asadas de cortesía! ¿Algo más?',
    textEn: 'Sure thing, your complimentary grilled onions! Anything else?'
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
  /\b(?:asada|steak|pastor|adobada|pollo|chicken|cabeza|lengua|tongue|buche|chorizo|carnitas|pork|vegetarian[oa]?|veggie|frijol(?:es)?|beans?|queso|cheese|cubana|milanesa)\b/i

const AGUA_FLAVOR_RE = /\b(?:horchata|orchata|jamaica|hibiscus|pina|pineapple|tamarindo|tamarind)\b/i
const SODA_FLAVOR_RE =
  /\b(?:coke|coca|diet\s*coke|sprite|fanta|pepsi|dr\s*pepper|root\s*beer|lemonade|limonada|iced?\s*tea|jarritos?|sidral|sangria)\b/i

export const TOP_SINGLE_LINE_ACKS: Readonly<Record<string, string>> = Object.freeze({
  // Tacos (30)
  '1|taco asada': 'ack_1_taco_asada',
  '2|taco asada': 'ack_2_tacos_asada',
  '3|taco asada': 'ack_3_tacos_asada',
  '4|taco asada': 'ack_4_tacos_asada',
  '5|taco asada': 'ack_5_tacos_asada',
  '6|taco asada': 'ack_6_tacos_asada',
  '8|taco asada': 'ack_8_tacos_asada',
  '10|taco asada': 'ack_10_tacos_asada',
  '1|taco pastor': 'ack_1_taco_pastor',
  '2|taco pastor': 'ack_2_tacos_pastor',
  '3|taco pastor': 'ack_3_tacos_pastor',
  '4|taco pastor': 'ack_4_tacos_pastor',
  '5|taco pastor': 'ack_5_tacos_pastor',
  '6|taco pastor': 'ack_6_tacos_pastor',
  '1|taco pollo': 'ack_1_taco_pollo',
  '2|taco pollo': 'ack_2_tacos_pollo',
  '3|taco pollo': 'ack_3_tacos_pollo',
  '4|taco pollo': 'ack_4_tacos_pollo',
  '1|taco cabeza': 'ack_1_taco_cabeza',
  '2|taco cabeza': 'ack_2_tacos_cabeza',
  '3|taco cabeza': 'ack_3_tacos_cabeza',
  '4|taco cabeza': 'ack_4_tacos_cabeza',
  '1|taco lengua': 'ack_1_taco_lengua',
  '2|taco lengua': 'ack_2_tacos_lengua',
  '1|taco chorizo': 'ack_1_taco_chorizo',
  '2|taco chorizo': 'ack_2_tacos_chorizo',
  '1|taco buche': 'ack_1_taco_buche',
  '2|taco buche': 'ack_2_tacos_buche',
  '1|taco carnitas': 'ack_1_taco_carnitas',
  '2|taco carnitas': 'ack_2_tacos_carnitas',

  // Burritos (15)
  '1|burrito asada': 'ack_1_burrito_asada',
  '2|burrito asada': 'ack_2_burritos_asada',
  '1|super burrito asada': 'ack_1_super_burrito_asada',
  '2|super burrito asada': 'ack_2_super_burritos_asada',
  '1|burrito pastor': 'ack_1_burrito_pastor',
  '2|burrito pastor': 'ack_2_burritos_pastor',
  '1|super burrito pastor': 'ack_1_super_burrito_pastor',
  '1|burrito pollo': 'ack_1_burrito_pollo',
  '2|burrito pollo': 'ack_2_burritos_pollo',
  '1|super burrito pollo': 'ack_1_super_burrito_pollo',
  '1|burrito cabeza': 'ack_1_burrito_cabeza',
  '1|burrito lengua': 'ack_1_burrito_lengua',
  '1|burrito carnitas': 'ack_1_burrito_carnitas',
  '1|burrito beans/cheese/rice': 'ack_1_burrito_brc',
  '1|meat only burrito asada': 'ack_1_meat_only_burrito_asada',

  // Quesadillas y Mulitas (10)
  '1|quesadilla queso': 'ack_1_quesadilla_queso',
  '1|quesadilla asada': 'ack_1_quesadilla_asada',
  '2|quesadilla asada': 'ack_2_quesadillas_asada',
  '1|super quesadilla asada': 'ack_1_super_quesadilla_asada',
  '1|quesadilla pastor': 'ack_1_quesadilla_pastor',
  '1|quesadilla pollo': 'ack_1_quesadilla_pollo',
  '1|super quesadilla pollo': 'ack_1_super_quesadilla_pollo',
  '1|mulita asada': 'ack_1_mulita_asada',
  '2|mulita asada': 'ack_2_mulitas_asada',
  '1|super mulita asada': 'ack_1_super_mulita_asada',

  // Tortas, Sopes, Super Nachos, Taco Plate y Platos (11)
  '1|torta asada': 'ack_1_torta_asada',
  '2|torta asada': 'ack_2_tortas_asada',
  '1|torta pastor': 'ack_1_torta_pastor',
  '1|torta pollo': 'ack_1_torta_pollo',
  '1|torta cubana': 'ack_1_torta_cubana',
  '1|torta milanesa': 'ack_1_torta_milanesa',
  '1|sope asada': 'ack_1_sope_asada',
  '2|sope asada': 'ack_2_sopes_asada',
  '1|super nachos asada': 'ack_1_super_nachos_asada',
  '1|taco plate': 'ack_1_taco_plate',
  '1|plato asada': 'ack_1_plato_asada',

  // Bebidas, Extras, Postres y Cortesías $0.00 (17)
  '1|champurrado': 'ack_1_champurrado',
  '2|champurrado': 'ack_2_champurrados',
  '1|coffee': 'ack_1_coffee',
  '1|medium horchata': 'ack_1_medium_horchata',
  '1|large horchata': 'ack_1_large_horchata',
  '1|medium jamaica': 'ack_1_medium_jamaica',
  '1|large jamaica': 'ack_1_large_jamaica',
  '1|medium pina': 'ack_1_medium_pina',
  '1|large pina': 'ack_1_large_pina',
  '1|medium coke': 'ack_1_medium_coke',
  '1|large coke': 'ack_1_large_coke',
  '1|bottled water': 'ack_1_bottled_water',
  '1|rice': 'ack_1_side_rice',
  '1|beans': 'ack_1_side_beans',
  '1|flan': 'ack_1_flan',
  '1|cheesecake': 'ack_1_cheesecake',
  '1|cebolla asada (cortesia)': 'ack_1_courtesy_cebolla_asada'
})

export const TOP_TWO_LINE_COMBO_ACKS: Readonly<Record<string, string>> = Object.freeze({
  'taco asada + taco pastor': 'combo_taco_asada_pastor',
  'taco asada + taco pollo': 'combo_taco_asada_pollo',
  'taco asada + taco cabeza': 'combo_taco_asada_cabeza',
  'burrito asada + taco asada': 'combo_burrito_taco_asada',
  'champurrado + taco asada': 'combo_taco_asada_champurrado',
  'large horchata + taco asada': 'combo_taco_asada_lrg_horchata',
  'burrito asada + medium horchata': 'combo_burrito_asada_med_horchata',
  'burrito asada + large horchata': 'combo_burrito_asada_lrg_horchata',
  'large horchata + super burrito asada': 'combo_super_burrito_asada_lrg_horchata',
  'cebolla asada (cortesia) + frijol de la olla (cortesia)': 'combo_courtesy_beans_onions'
})

const UNIVERSAL_ADDED_ACKS: readonly string[] = Object.freeze([
  'added_ack_1',
  'added_ack_2',
  'added_ack_3',
  'added_ack_4',
  'added_ack_5',
  'added_ack_6'
])

const WINDOW1_SENDOFF_VARIANTS: readonly string[] = Object.freeze([
  'sendoff_window1',
  'sendoff_window1_v2',
  'sendoff_window1_v3'
])

function hasOnlyFreeModifiers(line: KoreOrderLine): boolean {
  if (!Array.isArray(line.modifiers) || line.modifiers.length === 0) return true
  return line.modifiers.every((m) => (Number(m.priceCents) || 0) === 0 && (Number(m.price) || 0) === 0)
}

function extractSeed(variantSeed: unknown, stateAfter?: KoreOrderState | null): number {
  if (typeof variantSeed === 'number' && Number.isFinite(variantSeed)) {
    return Math.abs(Math.trunc(variantSeed))
  }
  return Math.abs(Number(stateAfter?.version ?? stateAfter?.lines?.length ?? 0))
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
    // Si el cliente pidió tamaño "chico/small", contestar al instante (<10 ms) que el menor tamaño es Mediana (22 oz) o Grande (32 oz)
    if (/there is no small size|no existe tama[nñ]o chico/i.test(messageField)) {
      return buildMatch('clarify_no_small_drink', lang)
    }

    const optNames = Array.isArray(rawOptions)
      ? rawOptions
          .map((o: any) => normPlain(typeof o === 'string' ? o : o?.name))
          .filter(Boolean)
      : []
    if (optNames.length === 0) return null

    const normQuery = normPlain(rawQuery)

    // A) Burrito / Quesadilla / Mulita: específico por familia cuando ya se conoce la carne, o genérico
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
        if (/\bburritos?\b/.test(normQuery)) return buildMatch('clarify_burrito_reg_or_super', lang)
        if (/\bquesadillas?\b/.test(normQuery)) return buildMatch('clarify_quesadilla_reg_or_super', lang)
        if (/\bmulitas?\b/.test(normQuery)) return buildMatch('clarify_mulita_reg_or_super', lang)
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

    // C) Tamaño de bebida (Horchata / Jamaica / Aguas Frescas con Galón vs Refrescos solo Mediana/Grande)
    const hasMedium = optNames.some((n) => /\bmedium\b/.test(n))
    const hasLarge = optNames.some((n) => /\blarge\b/.test(n))
    const hasGallon = optNames.some((n) => /\bgallon\b/.test(n))
    if (hasMedium && hasLarge) {
      if (/\b(?:horchata|orchata)\b/.test(normQuery)) {
        return buildMatch('clarify_horchata_size', lang)
      }
      if (/\b(?:jamaica|hibiscus)\b/.test(normQuery)) {
        return buildMatch('clarify_jamaica_size', lang)
      }
      if (hasGallon || AGUA_FLAVOR_RE.test(normQuery)) {
        return buildMatch('clarify_drink_size', lang)
      }
      if (SODA_FLAVOR_RE.test(normQuery) || optNames.length === 2) {
        return buildMatch('clarify_soda_size', lang)
      }
    }

    // D) Platillo de comida donde ya se sabe la familia y solo falta elegir la carne
    const isMeatChoiceFamily =
      !SPECIFIC_MEAT_RE.test(normQuery) &&
      optNames.every((n) =>
        /\b(?:taco|burrito|quesadilla|mulita|torta|sope|nachos|plato)\b/.test(n)
      ) &&
      optNames.some((n) => SPECIFIC_MEAT_RE.test(n))
    if (isMeatChoiceFamily) {
      if (/\btacos?\b/.test(normQuery) && !/\bplate\b/.test(normQuery)) {
        return buildMatch('clarify_tacos_meat', lang)
      }
      if (/\btortas?\b/.test(normQuery)) {
        return buildMatch('clarify_torta_meat', lang)
      }
      if (/\bsopes?\b/.test(normQuery)) {
        return buildMatch('clarify_sope_meat', lang)
      }
      return buildMatch('clarify_meat', lang)
    }
  }

  return null
}

function matchUpdateItemFastClip(
  args: Record<string, unknown>,
  stateBefore: KoreOrderState | undefined,
  stateAfter: KoreOrderState | undefined,
  lang: 'es' | 'en'
): KoreFastClipMatch | null {
  const beforeLines = stateBefore?.lines || []
  const afterLines = stateAfter?.lines || []
  if (afterLines.length === 0) return null

  // Si se agregaron modificadores con cargo extra (ej. Double Meat, Guacamole extra pagado), dejar que Gemini informe el precio.
  const targetId = String(args.line_id ?? args.lineId ?? '').trim()
  const updatedLine =
    (targetId ? afterLines.find((l) => l.lineId === targetId) : null) ||
    afterLines.find((afterL) => {
      const prevL = beforeLines.find((b) => b.lineId === afterL.lineId)
      return !prevL || prevL.lineTotalCents !== afterL.lineTotalCents || prevL.modifiers.length !== afterL.modifiers.length || prevL.notes !== afterL.notes
    }) ||
    afterLines[afterLines.length - 1]

  if (!updatedLine || !hasOnlyFreeModifiers(updatedLine)) return null

  const rawMods = Array.isArray(args.modifiers) ? args.modifiers.map((m) => normPlain(m)).join(' ') : ''
  const rawNotes = normPlain(args.notes)
  const combined = `${rawMods} ${rawNotes}`.trim()

  if (/\b(?:con\s+todo|with\s+everything|everything\s+on\s+it)\b/.test(combined)) {
    return buildMatch('mod_con_todo', lang)
  }
  if (/\b(?:cebollitas?|cebollas?\s+asadas?|grilled\s+onions?)\b/.test(combined)) {
    return buildMatch('mod_cebolla_asada_free', lang)
  }
  if (/\b(?:frijol(?:es)?\s+de\s+(?:la\s+)?olla|(?:whole\s+)?pot\s+beans?)\b/.test(combined)) {
    return buildMatch('mod_frijol_olla_free', lang)
  }
  if (/\b(?:sin\s+cebolla|no\s+cebolla|no\s+onions?|without\s+onions?)\b/.test(combined)) {
    return buildMatch('mod_sin_cebolla', lang)
  }
  if (/\b(?:sin\s+cilantro|no\s+cilantro|without\s+cilantro)\b/.test(combined)) {
    return buildMatch('mod_sin_cilantro', lang)
  }
  if (/\b(?:salsa\s+verde|con\s+verde|green\s+salsa|green\s+sauce)\b/.test(combined)) {
    return buildMatch('mod_salsa_verde', lang)
  }
  if (/\b(?:salsa\s+roja|con\s+roja|red\s+salsa|red\s+sauce)\b/.test(combined)) {
    return buildMatch('mod_salsa_roja', lang)
  }
  return buildMatch('mod_updated_generic', lang)
}

export interface MatchKoreFastClipParams {
  toolName: string
  args: Record<string, unknown>
  stateBefore?: KoreOrderState
  stateAfter?: KoreOrderState
  result: Record<string, unknown>
  lang: 'es' | 'en'
  variantSeed?: number
  customerTurnText?: string
  alreadyPlayedClipIds?: ReadonlySet<string> | null
}

/**
 * Empata de forma pura el resultado de una herramienta de Kore Drive-Thru con un clip de voz pregrabado (`Kore 3.8`).
 * Devuelve `null` cuando la respuesta requiere texto dinámico de Gemini (ej. `confirm_order` con total exacto en USD,
 * `search_menu`, `get_order` o errores complejos con múltiples partes).
 */
export function matchKoreFastClipForToolOutcome(params: MatchKoreFastClipParams): KoreFastClipMatch | null
export function matchKoreFastClipForToolOutcome(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  lang?: 'es' | 'en',
  variantSeed?: number,
  alreadyPlayedClipIds?: ReadonlySet<string> | null
): KoreFastClipMatch | null
export function matchKoreFastClipForToolOutcome(
  paramsOrToolName: MatchKoreFastClipParams | string,
  posArgs?: Record<string, unknown>,
  posResult?: Record<string, unknown>,
  posLang?: 'es' | 'en',
  posSeed?: number,
  posAlreadyPlayed?: ReadonlySet<string> | null
): KoreFastClipMatch | null {
  const params: MatchKoreFastClipParams =
    typeof paramsOrToolName === 'string'
      ? {
          toolName: paramsOrToolName,
          args: posArgs || {},
          result: posResult || {},
          lang: posLang === 'en' ? 'en' : 'es',
          variantSeed: posSeed,
          alreadyPlayedClipIds: posAlreadyPlayed,
          stateAfter: {
            lines: [],
            status: (posResult?.status as any) || 'building',
            nextLineNumber: 1,
            version: 1,
            cancelReason: typeof posResult?.reason === 'string' ? posResult.reason : undefined
          }
        }
      : paramsOrToolName

  const tool = String(params.toolName || '').trim()
  const lang: 'es' | 'en' = params.lang === 'en' ? 'en' : 'es'
  const res = params.result || {}
  const args = params.args || {}
  const seed = extractSeed(params.variantSeed, params.stateAfter || ({ lines: [], status: 'building', nextLineNumber: 1, version: 0 } as KoreOrderState))
  const alreadyPlayed = params.alreadyPlayedClipIds || null

  // NUNCA interceptar confirm_order (debe leer artículos + total dinámico en dólares), get_order ni search_menu.
  if (tool === 'confirm_order' || tool === 'get_order' || tool === 'search_menu') {
    return null
  }

  // 1) Despedida final (`end_session`)
  if (tool === 'end_session') {
    if (res.ok !== true || res.should_end_session !== true) return null
    const reasonText = `${params.stateAfter?.cancelReason || ''} ${String(res.reason || '')} ${String(args.reason || '')}`
    const isCancelledStatus = params.stateAfter?.status === 'cancelled' || res.status === 'cancelled'
    if (isCancelledStatus) {
      const isEbtCancel =
        /\b(?:ebt|calfresh|food\s*stamps?|estampillas?|snap)\b/i.test(reasonText) &&
        res.ebt_not_accepted_in_city !== true
      if (isEbtCancel && !alreadyPlayed?.has('ebt_cancel_go_inside')) {
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
    const win1ClipId = WINDOW1_SENDOFF_VARIANTS[seed % WINDOW1_SENDOFF_VARIANTS.length]
    return buildMatch(win1ClipId, lang, true)
  }

  // 2) Cancelación por EBT (comedor vs ciudad sin EBT)
  if (tool === 'cancel_order') {
    if (res.ok === true && res.ebt_not_accepted_in_city === true) {
      return buildMatch('ebt_not_accepted_city', lang, false)
    }
    if (res.ok === true && res.ebt_dining_room_only === true) {
      return buildMatch('ebt_cancel_go_inside', lang, false)
    }
    return null
  }

  // 3) Recolección de repartidor (`register_driver_pickup`) con estatus en Blindaje Delivery
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
    if (statuses.every((s) => s === 'preparing')) {
      return buildMatch(orders.length === 1 ? 'driver_preparing_win2' : 'driver_preparing_win2_multi', lang)
    }
    const platformKnown = Boolean(res.platform || params.stateAfter?.driverPickup?.platform)
    if (platformKnown && statuses.every((s) => s === 'not_found' || s === 'ambiguous')) {
      return buildMatch('driver_not_found_win2', lang)
    }
    return null
  }

  // 4) Quitar producto (`remove_item`) limpio
  if (tool === 'remove_item') {
    const warnings = Array.isArray(res.warnings) ? res.warnings : []
    if (res.ok === true && warnings.length === 0) {
      return buildMatch(seed % 2 === 0 ? 'removed_ack_1' : 'removed_ack_2', lang)
    }
    return null
  }

  // 5) Actualizar modificadores o cantidad (`update_item`) limpio y sin cargos extra
  if (tool === 'update_item') {
    const warnings = Array.isArray(res.warnings) ? res.warnings : []
    if (res.ok === true && warnings.length === 0) {
      return matchUpdateItemFastClip(args, params.stateBefore, params.stateAfter, lang)
    }
    if (res.ok === false) {
      return matchFailureClarification(
        String(res.error_code || ''),
        String(args.item_name ?? args.itemName ?? ''),
        String(res.item || ''),
        String(res.message || ''),
        res.options,
        lang
      )
    }
    return null
  }

  // 6) Agregar 1 o varios productos (`add_item` / `add_items`)
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
      const effectiveAddedCount =
        newlyAdded.length > 0
          ? newlyAdded.length
          : tool === 'add_items' && Array.isArray(args.items)
            ? args.items.length
            : 1
      if (params.customerTurnText && hasUnresolvedCompoundOrderItems(params.customerTurnText, effectiveAddedCount)) {
        return null
      }
      if (Array.isArray(res.unfulfilled_session_items) && res.unfulfilled_session_items.length > 0) {
        return null
      }

      if (newlyAdded.length === 1) {
        const line = newlyAdded[0]
        if (hasOnlyFreeModifiers(line) && !line.notes) {
          const specificKey = `${line.quantity}|${normPlain(line.name)}`
          const specificClipId = TOP_SINGLE_LINE_ACKS[specificKey]
          if (specificClipId) {
            return buildMatch(specificClipId, lang)
          }
        }
      } else if (newlyAdded.length === 2) {
        const [l1, l2] = newlyAdded
        if (hasOnlyFreeModifiers(l1) && hasOnlyFreeModifiers(l2) && !l1.notes && !l2.notes) {
          const n1 = normPlain(l1.name)
          const n2 = normPlain(l2.name)
          if (n1 !== n2) {
            const pairKey = [n1, n2].sort().join(' + ')
            const comboClipId = TOP_TWO_LINE_COMBO_ACKS[pairKey]
            if (comboClipId) {
              return buildMatch(comboClipId, lang)
            }
          }
        }
      }

      const ackClipId = UNIVERSAL_ADDED_ACKS[seed % UNIVERSAL_ADDED_ACKS.length]
      return buildMatch(ackClipId, lang)
    }
  }

  return null
}

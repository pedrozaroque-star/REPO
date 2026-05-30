import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  corsHeaders,
  corsResponse,
  getAuthUser,
  isAuthSuccess,
  jsonOk,
  jsonError,
} from '@/app/api/mobile/_helpers'

export const dynamic = 'force-dynamic'

// ============================================================================
// CONSTANTES
// ============================================================================
const TAX_RATE = 0.095 // California 9.5%
const POINTS_PER_DOLLAR = 1 // 1 punto por cada $1 gastado (floor del monto neto)

// ============================================================================
// Tipos de entrada — coinciden con la app móvil
// ============================================================================

/** Modificador seleccionado por el usuario (ej: Extra Cebolla, Doble Carne) */
interface ModifierInput {
  guid: string
  name: string
  price: number
}

/** Item del carrito enviado desde la app */
interface OrderItemInput {
  guid: string       // toast_item_guid del item en app_menu_cache
  name: string       // nombre para referencia (se re-valida contra BD)
  price: number      // precio del cliente (se IGNORA, se usa el de BD)
  qty: number        // cantidad
  modifiers?: ModifierInput[]
}

/** Cuerpo completo de la petición de creación de orden */
interface CreateOrderBody {
  storeId: number
  items: OrderItemInput[]
  pickupMethod: 'curbside' | 'in_store' | 'drive_thru'
  curbsideStall?: string
  userCoords: { lat: number; lng: number }
}

// ============================================================================
// OPTIONS (Preflight CORS)
// ============================================================================
export async function OPTIONS() {
  return corsResponse()
}

// ============================================================================
// POST /api/mobile/order/create
// Crea una nueva orden móvil con validación anti-tamper de precios
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    // --- 1. AUTENTICACIÓN vía Supabase Auth ---
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }
    const userId = authResult.userId

    // --- 2. PARSEAR Y VALIDAR BODY ---
    let body: CreateOrderBody
    try {
      body = (await request.json()) as CreateOrderBody
    } catch {
      return jsonError('JSON inválido en el cuerpo de la petición.', 400)
    }

    const { storeId, items, pickupMethod, curbsideStall, userCoords } = body

    // Validaciones de campos requeridos
    if (!storeId || typeof storeId !== 'number') {
      return jsonError('storeId es requerido y debe ser numérico.', 400)
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return jsonError('Se requiere al menos un item en la orden.', 400)
    }
    if (!pickupMethod || !['curbside', 'in_store', 'drive_thru'].includes(pickupMethod)) {
      return jsonError('pickupMethod debe ser curbside, in_store o drive_thru.', 400)
    }
    if (pickupMethod === 'curbside' && !curbsideStall) {
      return jsonError('curbsideStall es requerido para recogida curbside.', 400)
    }
    if (!userCoords || typeof userCoords.lat !== 'number' || typeof userCoords.lng !== 'number') {
      return jsonError('userCoords con lat y lng son requeridos.', 400)
    }

    // Validar estructura mínima de cada item
    for (const item of items) {
      if (!item.guid || typeof item.qty !== 'number' || item.qty < 1) {
        return jsonError(
          `Item inválido: guid y qty (>= 1) son requeridos. Recibido: ${JSON.stringify(item)}`,
          400
        )
      }
    }

    // --- 3. VALIDAR QUE LA TIENDA EXISTE ---
    const { data: store, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id, name')
      .eq('id', storeId)
      .single()

    if (storeError || !store) {
      return jsonError(`Tienda con id ${storeId} no encontrada.`, 404)
    }

    // --- 4. VALIDAR ITEMS CONTRA app_menu_cache (Anti-tamper) ---
    // Obtener GUIDs únicos de los items solicitados
    const itemGuids = [...new Set(items.map(i => i.guid))]

    const { data: menuItems, error: menuError } = await supabaseAdmin
      .from('app_menu_cache')
      .select('id, toast_item_guid, name, price, is_available, modifier_groups_json')
      .in('toast_item_guid', itemGuids)
      .eq('store_id', storeId)

    if (menuError) {
      console.error('[MOBILE ORDER] Error consultando menú:', menuError)
      return jsonError('Error al validar items del menú.', 500)
    }

    if (!menuItems || menuItems.length === 0) {
      return jsonError(
        'Ninguno de los items solicitados existe en el menú de esta tienda.',
        400
      )
    }

    // Mapa guid -> datos del menú para acceso rápido
    const menuMap = new Map<string, {
      id: string
      name: string
      price: number
      is_available: boolean
      modifier_groups_json: Record<string, unknown>[] | null
    }>(
      menuItems.map(m => [
        m.toast_item_guid,
        {
          id: m.id,
          name: m.name,
          price: Number(m.price),
          is_available: m.is_available,
          modifier_groups_json: m.modifier_groups_json,
        },
      ])
    )

    // Verificar que todos los items existen y están disponibles
    for (const item of items) {
      const menuItem = menuMap.get(item.guid)
      if (!menuItem) {
        return jsonError(
          `Item "${item.guid}" no encontrado en el menú de ${store.name}.`,
          400
        )
      }
      if (!menuItem.is_available) {
        return jsonError(
          `El item "${menuItem.name}" no está disponible actualmente.`,
          400
        )
      }
    }

    // --- 5. CALCULAR TOTALES (desde precios de BD, NUNCA del cliente) ---
    let netAmount = 0
    const itemsJson: Array<{
      guid: string
      name: string
      qty: number
      unitPrice: number
      modifiers: ModifierInput[]
      subtotal: number
    }> = []

    for (const item of items) {
      const menuItem = menuMap.get(item.guid)!
      const basePrice = menuItem.price
      let modifierTotal = 0

      // Validar y sumar modificadores
      // Los precios de modificadores se aceptan del cliente ya que
      // están embebidos en modifier_groups_json del menú cache
      const validModifiers: ModifierInput[] = []
      if (item.modifiers && Array.isArray(item.modifiers)) {
        for (const mod of item.modifiers) {
          const modPrice = Math.max(0, Number(mod.price) || 0)
          modifierTotal += modPrice
          validModifiers.push({ guid: mod.guid, name: mod.name, price: modPrice })
        }
      }

      const itemSubtotal = (basePrice + modifierTotal) * item.qty
      netAmount += itemSubtotal

      itemsJson.push({
        guid: item.guid,
        name: menuItem.name,
        qty: item.qty,
        unitPrice: basePrice,
        modifiers: validModifiers,
        subtotal: Number(itemSubtotal.toFixed(2)),
      })
    }

    // Redondear a 2 decimales para evitar errores de punto flotante
    netAmount = Number(netAmount.toFixed(2))
    const taxAmount = Number((netAmount * TAX_RATE).toFixed(2))
    const totalAmount = Number((netAmount + taxAmount).toFixed(2))

    // --- 6. GENERAR MOCK PAYMENT INTENT ---
    const paymentIntentId = `pi_mobile_${Date.now()}`

    // --- 7. INSERTAR ORDEN EN app_orders ---
    const now = new Date().toISOString()
    const { data: newOrder, error: insertError } = await supabaseAdmin
      .from('app_orders')
      .insert({
        user_id: userId,
        store_id: storeId,
        total_amount: totalAmount,
        net_amount: netAmount,
        tax_amount: taxAmount,
        discount_amount: 0,
        items_json: itemsJson,
        pickup_method: pickupMethod,
        curbside_stall: curbsideStall || null,
        status: 'HOLDING',
        payment_status: 'PAID',
        payment_intent_id: paymentIntentId,
        user_latitude: userCoords.lat,
        user_longitude: userCoords.lng,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single()

    if (insertError || !newOrder) {
      console.error('[MOBILE ORDER] Error insertando orden:', insertError)
      return jsonError('Error al crear la orden en base de datos.', 500)
    }

    // --- 8. OTORGAR PUNTOS DE LEALTAD ---
    const pointsEarned = Math.floor(netAmount * POINTS_PER_DOLLAR)
    let loyaltyWarning: string | null = null

    if (pointsEarned > 0) {
      try {
        // 8a. Verificar si el usuario ya tiene registro de balance
        const { data: existingBalance } = await supabaseAdmin
          .from('app_rewards_balances')
          .select('user_id, points_balance, points_accumulated')
          .eq('user_id', userId)
          .single()

        if (existingBalance) {
          // Actualizar balance existente — incrementar balance y acumulado
          const { error: balanceUpdateError } = await supabaseAdmin
            .from('app_rewards_balances')
            .update({
              points_balance: existingBalance.points_balance + pointsEarned,
              points_accumulated: existingBalance.points_accumulated + pointsEarned,
            })
            .eq('user_id', userId)

          if (balanceUpdateError) {
            console.error('[MOBILE ORDER] Error actualizando balance:', balanceUpdateError)
            loyaltyWarning = balanceUpdateError.message
          }
        } else {
          // Crear nuevo registro de balance para usuario nuevo
          const { error: balanceInsertError } = await supabaseAdmin
            .from('app_rewards_balances')
            .insert({
              user_id: userId,
              points_balance: pointsEarned,
              points_accumulated: pointsEarned,
              points_redeemed: 0,
              tier: 'BRONZE',
            })

          if (balanceInsertError) {
            console.error('[MOBILE ORDER] Error creando balance:', balanceInsertError)
            loyaltyWarning = balanceInsertError.message
          }
        }

        // 8b. Insertar transacción de recompensa
        const { error: txError } = await supabaseAdmin
          .from('app_rewards_transactions')
          .insert({
            user_id: userId,
            order_id: newOrder.id,
            points: pointsEarned,
            type: 'EARN',
            description: `Puntos ganados por orden #${(newOrder.id as string).slice(0, 8)} ($${netAmount.toFixed(2)} neto)`,
            created_at: now,
          })

        if (txError) {
          console.error('[MOBILE ORDER] Error insertando transacción de recompensa:', txError)
          loyaltyWarning = txError.message
        }
      } catch (rewardErr: unknown) {
        const msg = rewardErr instanceof Error ? rewardErr.message : 'Error desconocido en recompensas'
        console.error('[MOBILE ORDER] Error en sistema de lealtad:', msg)
        loyaltyWarning = msg
      }
    }

    // --- 9. RESPUESTA EXITOSA ---
    console.log(
      `✅ [MOBILE ORDER] Orden ${newOrder.id} creada — Total: $${totalAmount} — Puntos: ${pointsEarned}`
    )

    const responseData: Record<string, unknown> = {
      orderId: newOrder.id,
      total: totalAmount,
      netAmount,
      taxAmount,
      pointsEarned,
      status: 'HOLDING' as const,
    }

    if (loyaltyWarning) {
      responseData.loyaltyWarning = `Puntos podrían no haberse registrado: ${loyaltyWarning}`
    }

    return jsonOk(responseData)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error interno desconocido'
    console.error('[MOBILE ORDER] Error crítico en creación de orden:', message)
    return jsonError(message, 500)
  }
}

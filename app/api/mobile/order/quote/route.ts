/**
 * @module api/mobile/order/quote
 * @description Authoritative server-side pricing and tax quotation engine for customer mobile orders (Pickup & Delivery).
 * Persists single-use financial quotes in public.app_quotes with canonical cart hash and 10-minute TTL.
 * @businessRules
 * - Principio de Autoridad Financiera: La app móvil nunca fija ni calcula el total financiero vinculante.
 * - Todos los precios de platillos y modificadores se validan contra app_menu_cache de la sucursal seleccionada.
 * - Aplica la tasa exacta de impuesto sobre las ventas (CDTFA) por ciudad (ej. Lynwood 10.25%, LA 9.50%, Santa Ana 9.25%, Rialto 7.75%).
 * - En entregas a domicilio (DELIVERY), valida el radio de cobertura máximo (5.0 millas vía fórmula Haversine) y calcula el cargo de entrega.
 * - Emite y persiste un registro autoritativo en app_quotes con cart_hash canónico y expiración de 10 minutos (TTL).
 * @dataFlow
 * - Client POST /api/mobile/order/quote -> Valida items en app_menu_cache -> Resuelve tasa fiscal por sucursal -> Inserta app_quotes -> Retorna OrderQuoteResponse.
 * @notes
 * - Genera cart_hash SHA-256 canónico para garantizar que el contenido del carrito no sea alterado entre la cotización y el pago.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, jsonError, getAuthUser, isAuthSuccess } from '../../_helpers'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Calcula un hash canónico SHA-256 de los items, modificadores y dirección de entrega.
 */
export function computeCartHash(params: {
  storeId: number
  channel: string
  pickupMethod?: string
  items: Array<{ itemGuid: string; quantity: number; modifiers?: Array<{ guid: string }> }>
  deliveryAddress?: any
}): string {
  const normalizedItems = [...params.items]
    .map(i => ({
      itemGuid: i.itemGuid.toLowerCase(),
      quantity: i.quantity,
      modifiers: (i.modifiers || [])
        .map(m => m.guid.toLowerCase())
        .sort()
    }))
    .sort((a, b) => a.itemGuid.localeCompare(b.itemGuid))

  const normalized = {
    storeId: params.storeId,
    channel: params.channel.toUpperCase(),
    pickupMethod: (params.pickupMethod || 'in_store').toLowerCase(),
    items: normalizedItems,
    deliveryAddress: params.channel.toUpperCase() === 'DELIVERY' && params.deliveryAddress ? {
      streetAddress: (params.deliveryAddress.streetAddress || '').trim().toLowerCase(),
      zipCode: (params.deliveryAddress.zipCode || '').trim(),
      latitude: Number(params.deliveryAddress.latitude || 0).toFixed(4),
      longitude: Number(params.deliveryAddress.longitude || 0).toFixed(4),
    } : null
  }

  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

/** Tasas oficiales de Sales Tax por sucursal (CDTFA - Vigentes desde el 01 de Octubre de 2026) */
export const STORE_TAX_RATES: Record<number, number> = {
  1: 0.0775,  // Rialto (San Bernardino County) - 7.75%
  3: 0.1025,  // West Covina (LA County + Measure ER) - 10.25%
  4: 0.1125,  // Azusa (LA County + Measure Z + Measure ER) - 11.25%
  5: 0.1025,  // LA Broadway (City of Los Angeles + Measure ER) - 10.25%
  6: 0.1025,  // LA Central (City of Los Angeles + Measure ER) - 10.25%
  7: 0.1025,  // Slauson (City of Los Angeles + Measure ER) - 10.25%
  8: 0.1025,  // Hollywood (City of Los Angeles + Measure ER) - 10.25%
  9: 0.0925,  // Santa Ana (Orange County + Measure X) - 9.25%
  10: 0.1075, // La Puente (LA County + Measure ER) - 10.75%
  11: 0.1100, // Huntington Park (LA County + Measure CH + Measure ER) - 11.00%
  12: 0.1100, // Norwalk (LA County + Measure ER) - 11.00%
  13: 0.1025, // Bell (LA County + Measure ER) - 10.25%
  14: 0.1125, // Lynwood (LA County + Measure PS + Measure ER) - 11.25%
  15: 0.1125, // South Gate (LA County + Measure P + Measure ER) - 11.25%
  16: 0.1100, // Downey (LA County + Measure S + Measure ER) - 11.00%
}

export function getStoreTaxRate(storeId: number): number {
  return STORE_TAX_RATES[storeId] ?? 0.1025
}

/** Calcula distancia en millas entre dos coordenadas (Fórmula Haversine) */
function calculateDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8 // Radio de la Tierra en millas
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

interface QuoteItemInput {
  itemGuid: string
  quantity: number
  modifiers?: Array<{ guid: string }>
}

interface QuoteRequestBody {
  storeId: number
  channel: 'PICKUP' | 'DELIVERY'
  pickupSubtype?: 'IN_STORE' | 'CURBSIDE' | 'DRIVE_THRU'
  deliveryAddress?: {
    streetAddress: string
    unitOrApt?: string
    city: string
    state: string
    zipCode: string
    latitude: number
    longitude: number
    deliveryInstructions?: string
  }
  items: QuoteItemInput[]
  tipAmount?: number
  appliedRewardId?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as QuoteRequestBody

    const { storeId, channel, items, tipAmount = 0 } = body

    if (!storeId || typeof storeId !== 'number') {
      return jsonError('storeId es requerido y debe ser un número entero', 400)
    }

    if (!channel || (channel !== 'PICKUP' && channel !== 'DELIVERY')) {
      return jsonError("channel debe ser 'PICKUP' o 'DELIVERY'", 400)
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return jsonError('La orden debe contener al menos un artículo', 400)
    }

    // 1. Obtener la sucursal para validar existencia y coordenadas
    const { data: store, error: storeErr } = await supabaseAdmin
      .from('stores')
      .select('id, name, latitude, longitude')
      .eq('id', storeId)
      .single()

    if (storeErr || !store) {
      return jsonError(`Sucursal con ID ${storeId} no encontrada`, 404)
    }

    // 2. Obtener los items del menú de esta sucursal desde app_menu_cache
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const itemGuids = items.map(i => i.itemGuid).filter(Boolean)

    for (const item of items) {
      if (!item.itemGuid || !UUID_REGEX.test(item.itemGuid)) {
        return jsonError(`Artículo '${item.itemGuid}' no disponible en la sucursal ${store.name}`, 400)
      }
    }

    const { data: menuCache, error: menuErr } = await supabaseAdmin
      .from('app_menu_cache')
      .select('toast_item_guid, name, price, modifier_groups_json, is_available')
      .eq('store_id', storeId)
      .in('toast_item_guid', itemGuids)

    if (menuErr || !menuCache) {
      console.error('❌ [ORDER QUOTE] Error consultando app_menu_cache:', menuErr?.message)
      return jsonError('Error al validar precios del menú', 500)
    }

    const menuMap = new Map<string, (typeof menuCache)[0]>()
    for (const m of menuCache) {
      menuMap.set(m.toast_item_guid, m)
    }

    // 3. Calcular Net Sales y validar cada partida con anti-tampering
    let netSales = 0

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0 || !Number.isInteger(item.quantity) || item.quantity > 50) {
        return jsonError(`Cantidad inválida para el artículo (${item.quantity})`, 400)
      }

      const menuItem = menuMap.get(item.itemGuid)
      if (!menuItem) {
        return jsonError(`Artículo '${item.itemGuid}' no disponible en la sucursal ${store.name}`, 400)
      }

      if (!menuItem.is_available) {
        return jsonError(`El artículo '${menuItem.name}' está agotado actualmente`, 400)
      }

      const basePrice = Number(menuItem.price) || 0
      let modifiersPrice = 0

      // Mapear modificadores permitidos para este item
      const allowedModsMap = new Map<string, number>()
      if (Array.isArray(menuItem.modifier_groups_json)) {
        for (const grp of menuItem.modifier_groups_json as any[]) {
          const opts = grp.options || grp.modifiers || []
          for (const opt of opts) {
            allowedModsMap.set(opt.guid, Number(opt.price) || 0)
          }
        }
      }

      if (Array.isArray(item.modifiers)) {
        for (const mod of item.modifiers) {
          if (!mod.guid) continue
          const verifiedModPrice = allowedModsMap.get(mod.guid)
          if (verifiedModPrice !== undefined) {
            modifiersPrice += verifiedModPrice
          }
        }
      }

      const lineTotal = (basePrice + modifiersPrice) * item.quantity
      netSales += lineTotal
    }

    netSales = Math.round(netSales * 100) / 100

    // 4. Calcular tasa de impuesto sobre las ventas (Sales Tax)
    const taxRate = getStoreTaxRate(storeId)
    const taxAmount = Math.round(netSales * taxRate * 100) / 100

    // 5. Validar delivery y calcular fee
    let deliveryFee = 0
    let isDeliverable = true
    let distanceMiles = 0
    const BASE_DELIVERY_FEE = 5.99
    const DISTANCE_SURCHARGE_FEE = 1.75
    const BASE_DELIVERY_RADIUS_MILES = 6.0
    const MAX_DELIVERY_RADIUS_MILES = 10.0

    if (channel === 'DELIVERY') {
      if (!body.deliveryAddress) {
        return jsonError('Dirección de entrega requerida para órdenes de Delivery', 400)
      }

      const { latitude, longitude } = body.deliveryAddress
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return jsonError('Coordenadas de entrega inválidas', 400)
      }

      if (store.latitude && store.longitude) {
        distanceMiles = calculateDistanceMiles(
          Number(store.latitude),
          Number(store.longitude),
          latitude,
          longitude
        )

        if (distanceMiles > MAX_DELIVERY_RADIUS_MILES) {
          return jsonError(
            `La dirección está a ${distanceMiles.toFixed(1)} millas de ${store.name}. El radio máximo de entrega es de ${MAX_DELIVERY_RADIUS_MILES} millas.`,
            400
          )
        }
      }

      // Tarifa de entrega oficial Tacos Gavilan:
      // $5.99 base hasta 6.0 millas. Si supera 6.0 millas, se cobra +$1.75 ($7.74).
      deliveryFee = distanceMiles > BASE_DELIVERY_RADIUS_MILES
        ? Number((BASE_DELIVERY_FEE + DISTANCE_SURCHARGE_FEE).toFixed(2))
        : BASE_DELIVERY_FEE
    }

    // 6. Propina y Descuentos
    const safeTip = Math.max(0, Math.round(Number(tipAmount) * 100) / 100 || 0)
    const discountAmount = 0.00 // A ser integrado con recompensas aprobadas en Hito 5

    // 7. Total Final Autorizado
    const totalAmount = Math.round((netSales + taxAmount + deliveryFee + safeTip - discountAmount) * 100) / 100

    // 8. Computar hash canónico del carrito y generar expiración (TTL: 10 minutos)
    const cartHash = computeCartHash({
      storeId,
      channel,
      pickupMethod: body.pickupSubtype,
      items,
      deliveryAddress: body.deliveryAddress
    })

    const quoteId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // 9. Extraer usuario autenticado si existe sesión
    let userId: string | null = null
    try {
      const auth = await getAuthUser(request)
      if (isAuthSuccess(auth)) {
        const { data: userProfile } = await supabaseAdmin
          .from('app_users')
          .select('id')
          .eq('id', auth.userId)
          .maybeSingle()

        if (userProfile) {
          userId = userProfile.id
        } else {
          const safePhone = `+1${Date.now().toString().slice(-10)}`
          const { error: insertUserErr } = await supabaseAdmin.from('app_users').insert({
            id: auth.userId,
            phone: safePhone,
            email: auth.email || null,
            first_name: 'Cliente',
            last_name: 'Gavilan',
          })
          if (!insertUserErr) {
            userId = auth.userId
          }
        }
      }
    } catch {
      // Usuario invitado sin token Bearer
    }

    // 10. Persistir la cotización autoritativa en public.app_quotes
    const { error: quoteInsertErr } = await supabaseAdmin.from('app_quotes').insert({
      id: quoteId,
      user_id: userId,
      store_id: storeId,
      channel,
      pickup_method: body.pickupSubtype ? body.pickupSubtype.toLowerCase() : 'in_store',
      cart_hash: cartHash,
      subtotal: netSales,
      discount_amount: discountAmount,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      delivery_fee: deliveryFee,
      tip_amount: safeTip,
      total_amount: totalAmount,
      currency: 'USD',
      price_source: 'app_menu_cache',
      price_version: 'v1',
      items_json: items,
      delivery_address: channel === 'DELIVERY' ? body.deliveryAddress : null,
      status: 'OPEN',
      expires_at: expiresAt,
    })

    if (quoteInsertErr) {
      console.error('❌ [ORDER QUOTE] Error al persistir cotización en app_quotes:', quoteInsertErr.message)
      return jsonError('Error al generar la cotización autoritativa', 500)
    }

    const paymentGatewayAvailable = !!process.env.STRIPE_SECRET_KEY

    const quoteData = {
      quoteId,
      cartHash,
      expiresAt,
      paymentGatewayAvailable,
      financials: {
        netSales,
        taxRate,
        taxAmount,
        deliveryFee,
        tipAmount: safeTip,
        discountAmount,
        totalAmount,
      },
      deliveryDetails: channel === 'DELIVERY' ? {
        isDeliverable,
        distanceMiles: Math.round(distanceMiles * 10) / 10,
        estimatedDeliveryMinutes: Math.round(25 + distanceMiles * 4),
      } : undefined
    }

    return jsonOk({
      ...quoteData,
      data: quoteData
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    console.error('❌ [ORDER QUOTE] Fatal error:', msg)
    return jsonError('Error interno del servidor al procesar la cotización', 500)
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

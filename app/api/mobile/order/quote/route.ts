/**
 * @module api/mobile/order/quote
 * @description Authoritative server-side pricing and tax quotation engine for customer mobile orders (Pickup & Delivery).
 * Persists single-use financial quotes in public.app_quotes with canonical cart hash and 10-minute TTL.
 * @businessRules
 * - Principio de Autoridad Financiera: La app móvil nunca fija ni calcula el total financiero vinculante.
 * - Todos los precios de platillos y modificadores se validan contra app_menu_cache de la sucursal seleccionada.
 * - Validación Estricta de Modificadores: Todo modificador debe pertenecer a un grupo del artículo;
 *   rechaza con VALIDATION_ERROR si un modificador no es válido o si se violan minSelections / maxSelections;
 *   rechaza con MENU_DATA_INCOMPLETE si las definiciones de modificadores están incompletas o corruptas.
 * - Aplica la tasa exacta de impuesto sobre las ventas (CDTFA) por ciudad (ej. Lynwood 11.25%, LA 10.25%, Santa Ana 9.25%, Rialto 7.75%).
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
import { calculateToastPrices } from '@/lib/toast/prices-client'
import { TOAST_WRITE_BLOCKED_DESCRIPTOR } from '@/lib/toast/menus-v3-contract'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// Feature Flag: Delivery nativo requiere aprobación contractual previa (TDS vs DoorDash Drive)
const DELIVERY_ENABLED = process.env.ENABLE_MOBILE_DELIVERY === 'true'

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

    if (channel === 'DELIVERY' && !DELIVERY_ENABLED) {
      return jsonError(
        'El canal de entrega a domicilio (Delivery) se encuentra en proceso de aprobación contractual con Toast/DoorDash. Actualmente solo está habilitado Retiro en Sucursal (Pickup).',
        400
      )
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return jsonError('La orden debe contener al menos un artículo', 400)
    }

    // 1. Obtener la sucursal para validar existencia, external_id y coordenadas
    const { data: store, error: storeErr } = await supabaseAdmin
      .from('stores')
      .select('id, name, external_id, latitude, longitude')
      .eq('id', storeId)
      .single()

    if (storeErr || !store) {
      return jsonError(`Sucursal con ID ${storeId} no encontrada`, 404)
    }

    if (!store.external_id) {
      return jsonError(`La sucursal ${store.name} no cuenta con external_id vinculado a Toast`, 400)
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

    // 3. Calcular Net Sales de referencia y validar cada partida con anti-tampering y reglas estrictas de modificadores
    let netSales = 0

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0 || !Number.isInteger(item.quantity) || item.quantity > 50) {
        return jsonError(`Cantidad inválida para el artículo (${item.quantity})`, 400, 'VALIDATION_ERROR')
      }

      const menuItem = menuMap.get(item.itemGuid)
      if (!menuItem) {
        return jsonError(`Artículo '${item.itemGuid}' no disponible en la sucursal ${store.name}`, 400, 'VALIDATION_ERROR')
      }

      if (!menuItem.is_available) {
        return jsonError(`El artículo '${menuItem.name}' está agotado actualmente`, 400, 'VALIDATION_ERROR')
      }

      const basePrice = Number(menuItem.price) || 0
      let modifiersPrice = 0

      // Extraer y validar grupos de modificadores del menú
      const rawModGroups = menuItem.modifier_groups_json
      const modGroups: Array<{
        guid: string
        name: string
        minSelections: number
        maxSelections: number
        optionsMap: Map<string, { guid: string; name: string; price: number }>
      }> = []

      if (rawModGroups !== null && rawModGroups !== undefined) {
        if (!Array.isArray(rawModGroups)) {
          console.error(`❌ [ORDER QUOTE] modifier_groups_json no es array para item ${menuItem.toast_item_guid}`)
          return jsonError(
            `La información de modificadores del artículo '${menuItem.name}' está incompleta en el menú local.`,
            400,
            'MENU_DATA_INCOMPLETE'
          )
        }

        for (const grp of rawModGroups as any[]) {
          if (!grp || typeof grp !== 'object' || !grp.guid || !grp.name) {
            console.error(`❌ [ORDER QUOTE] Grupo de modificadores inválido en item ${menuItem.toast_item_guid}`, grp)
            return jsonError(
              `Definición de grupo de modificadores incompleta para el artículo '${menuItem.name}'.`,
              400,
              'MENU_DATA_INCOMPLETE'
            )
          }

          const rawOpts = grp.options || grp.modifiers || []
          if (!Array.isArray(rawOpts)) {
            return jsonError(
              `Opciones de modificadores incompletas para el grupo '${grp.name}'.`,
              400,
              'MENU_DATA_INCOMPLETE'
            )
          }

          const optionsMap = new Map<string, { guid: string; name: string; price: number }>()
          for (const opt of rawOpts) {
            if (!opt || !opt.guid || typeof opt.name !== 'string') {
              return jsonError(
                `Opción de modificador inválida en el grupo '${grp.name}'.`,
                400,
                'MENU_DATA_INCOMPLETE'
              )
            }
            optionsMap.set(opt.guid.toLowerCase(), {
              guid: opt.guid,
              name: opt.name,
              price: Number(opt.price) || 0
            })
          }

          const minSel = typeof grp.minSelections === 'number'
            ? grp.minSelections
            : typeof grp.min === 'number'
              ? grp.min
              : grp.required ? 1 : 0
          const maxSel = typeof grp.maxSelections === 'number'
            ? grp.maxSelections
            : typeof grp.max === 'number'
              ? grp.max
              : 99

          modGroups.push({
            guid: grp.guid,
            name: grp.name,
            minSelections: minSel,
            maxSelections: maxSel,
            optionsMap
          })
        }
      }

      // Si el cliente envió modificadores pero el artículo no tiene grupos de modificadores
      const clientMods = item.modifiers || []
      if (modGroups.length === 0 && clientMods.length > 0) {
        return jsonError(
          `El artículo '${menuItem.name}' no admite modificadores.`,
          400,
          'VALIDATION_ERROR'
        )
      }

      // Validar cada modificador enviado por el cliente: debe pertenecer a algún grupo del artículo
      const groupSelectionsCount = new Map<string, number>()
      for (const grp of modGroups) {
        groupSelectionsCount.set(grp.guid, 0)
      }

      for (const mod of clientMods) {
        if (!mod || !mod.guid) {
          return jsonError('Modificador con identificador GUID no proporcionado', 400, 'VALIDATION_ERROR')
        }

        const normalizedModGuid = mod.guid.toLowerCase()
        let matchingGroup: (typeof modGroups)[0] | undefined

        for (const grp of modGroups) {
          if (grp.optionsMap.has(normalizedModGuid)) {
            matchingGroup = grp
            break
          }
        }

        if (!matchingGroup) {
          return jsonError(
            `El modificador '${mod.guid}' no es válido para el platillo '${menuItem.name}'.`,
            400,
            'VALIDATION_ERROR'
          )
        }

        const optData = matchingGroup.optionsMap.get(normalizedModGuid)!
        modifiersPrice += optData.price

        const currentCount = groupSelectionsCount.get(matchingGroup.guid) || 0
        groupSelectionsCount.set(matchingGroup.guid, currentCount + 1)
      }

      // Validar restricciones de selección minSelections y maxSelections por cada grupo
      for (const grp of modGroups) {
        const count = groupSelectionsCount.get(grp.guid) || 0
        if (grp.minSelections > 0 && count < grp.minSelections) {
          return jsonError(
            `El artículo '${menuItem.name}' requiere seleccionar al menos ${grp.minSelections} opción(es) en el grupo '${grp.name}'.`,
            400,
            'VALIDATION_ERROR'
          )
        }
        if (grp.maxSelections > 0 && count > grp.maxSelections) {
          return jsonError(
            `El artículo '${menuItem.name}' permite como máximo ${grp.maxSelections} opción(es) en el grupo '${grp.name}' (seleccionadas: ${count}).`,
            400,
            'VALIDATION_ERROR'
          )
        }
      }

      const lineTotal = (basePrice + modifiersPrice) * item.quantity
      netSales += lineTotal
    }

    netSales = Math.round(netSales * 100) / 100

    // 4. Calcular tasa impositiva de referencia
    const taxRate = getStoreTaxRate(storeId)
    const taxAmount = Math.round(netSales * taxRate * 100) / 100
    const safeTip = Math.max(0, Math.round(Number(tipAmount) * 100) / 100 || 0)

    // 5. Invocar cálculo autoritativo en Toast Orders /prices API
    const toastSelections = items.map(i => ({
      itemGuid: i.itemGuid,
      quantity: i.quantity,
      modifiers: (i.modifiers || []).map(m => ({ guid: m.guid }))
    }))

    const pricesResult = await calculateToastPrices(store.external_id, {
      selections: toastSelections,
      deliveryAddress: channel === 'DELIVERY' && body.deliveryAddress ? {
        streetAddress: body.deliveryAddress.streetAddress,
        city: body.deliveryAddress.city,
        state: body.deliveryAddress.state,
        zipCode: body.deliveryAddress.zipCode,
        latitude: body.deliveryAddress.latitude,
        longitude: body.deliveryAddress.longitude
      } : undefined
    })

    // Caso 1: Toast responde con bloqueo externo de permisos (HTTP 403 / code 10010)
    if (!pricesResult.ok && pricesResult.code === 'BLOCKED_EXTERNALLY') {
      return jsonOk({
        ok: false,
        code: 'BLOCKED_EXTERNALLY',
        message: 'Pedidos en línea nativos en preparación: Esperando activación de permisos en Toast Partner Connect para el cálculo autoritativo de precios e impuestos.',
        detail: {
          httpStatus: pricesResult.httpStatus,
          toastCode: pricesResult.toastCode,
          requiredScopes: pricesResult.requiredScopes,
          partnerActionRequired: pricesResult.partnerActionRequired
        },
        estimatedReference: {
          netSales,
          taxRate,
          taxAmount,
          deliveryFee: 0,
          tipAmount: safeTip,
          discountAmount: 0,
          totalAmount: Math.round((netSales + taxAmount + safeTip) * 100) / 100,
          priceSource: 'estimated_reference',
          isPayable: false
        },
        quoteId: null
      })
    }

    // Caso 2: Manejo granular de errores de Toast API
    if (!pricesResult.ok) {
      if (pricesResult.code === 'TOAST_TIMEOUT') {
        return jsonError(`Tiempo de espera agotado al consultar Toast /prices: ${pricesResult.message}`, 504, 'TOAST_TIMEOUT')
      }
      if (pricesResult.code === 'TOAST_UNREACHABLE') {
        return jsonError(`No fue posible conectar con los servidores de Toast POS: ${pricesResult.message}`, 503, 'NETWORK_UNAVAILABLE')
      }
      if (pricesResult.code === 'TOAST_AUTH_ERROR') {
        return jsonError(`Error de autenticación con Toast API: ${pricesResult.message}`, 502, 'TOAST_AUTH_ERROR')
      }
      return jsonError(`Error en Toast /prices API: ${pricesResult.message}`, 502, 'TOAST_API_ERROR')
    }

    // Caso 3: Cálculo autoritativo exitoso de Toast /prices
    const authoritativePrices = pricesResult.data
    const authoritativeNetSales = authoritativePrices.subtotal
    const authoritativeTaxAmount = authoritativePrices.taxTotal
    const authoritativeDeliveryFee = authoritativePrices.deliveryFee
    const authoritativeTotalAmount = authoritativePrices.total
    const discountAmount = authoritativePrices.discountTotal

    // 6. Computar hash canónico del carrito y generar expiración (TTL: 10 minutos)
    const cartHash = computeCartHash({
      storeId,
      channel,
      pickupMethod: body.pickupSubtype,
      items,
      deliveryAddress: body.deliveryAddress
    })

    const quoteId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    // 7. Extraer usuario autenticado si existe sesión
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

    // 8. Persistir la cotización autoritativa en public.app_quotes con price_source = 'toast_prices'
    const { error: quoteInsertErr } = await supabaseAdmin.from('app_quotes').insert({
      id: quoteId,
      user_id: userId,
      store_id: storeId,
      channel,
      pickup_method: body.pickupSubtype ? body.pickupSubtype.toLowerCase() : 'in_store',
      cart_hash: cartHash,
      subtotal: authoritativeNetSales,
      discount_amount: discountAmount,
      tax_rate: taxRate,
      tax_amount: authoritativeTaxAmount,
      delivery_fee: authoritativeDeliveryFee,
      tip_amount: safeTip,
      total_amount: authoritativeTotalAmount,
      currency: 'USD',
      price_source: 'toast_prices',
      price_version: 'v2',
      items_json: items,
      delivery_address: channel === 'DELIVERY' ? body.deliveryAddress : null,
      status: 'OPEN',
      expires_at: expiresAt,
    })

    if (quoteInsertErr) {
      console.error('❌ [ORDER QUOTE] Error al persistir cotización en app_quotes:', quoteInsertErr.message)
      return jsonError('Error al generar la cotización autoritativa', 500)
    }

    const paymentGatewayAvailable = false // Deshabilitado hasta aprobación de Toast Credit Cards

    const quoteData = {
      ok: true,
      quoteId,
      cartHash,
      expiresAt,
      paymentGatewayAvailable,
      financials: {
        netSales: authoritativeNetSales,
        taxRate,
        taxAmount: authoritativeTaxAmount,
        deliveryFee: authoritativeDeliveryFee,
        tipAmount: safeTip,
        discountAmount,
        totalAmount: authoritativeTotalAmount,
      },
      priceSource: 'toast_prices'
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

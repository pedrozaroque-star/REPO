/**
 * @module api/mobile/order/quote
 * @description Endpoint autoritativo de cotización financiera nativa para Tacos Gavilan App.
 * Valida platillos y modificadores mediante el validador unificado `validateCartLineAgainstMenuV3`,
 * consulta Toast Orders API (`/orders/v2/prices`) y persiste cotizaciones únicamente cuando
 * Toast devuelve precios autoritativos (`price_source = 'toast_prices'`).
 *
 * @businessRules
 * - Cero tasas estáticas de impuestos (`STORE_TAX_RATES` eliminado del flujo productivo).
 * - Todo cálculo de impuestos, service charges, tarifas y total comprable proviene exclusivamente
 *   de Toast POS (`POST /orders/v2/prices`).
 * - Si Toast devuelve `HTTP 403 / code 10010`, responde `TOAST_SCOPE_BLOCKED` con `quoteId: null`
 *   y expone únicamente `catalogSubtotal` como referencia no pagable (`nonPayableEstimate: true`).
 * - Delivery permanece deshabilitado por feature flag (`ENABLE_MOBILE_DELIVERY === 'true'`).
 * - Cero creación de perfiles de usuario ficticios en `app_users`.
 *
 * @dataFlow
 * - POST /api/mobile/order/quote -> `app_menu_cache` -> `validateCartLineAgainstMenuV3`
 *   -> `calculateToastPrices` (`/orders/v2/prices`) -> `app_quotes` (solo si `toast_prices`).
 *
 * @notes
 * - Unificado con `validateCartLineAgainstMenuV3` y removido `STORE_TAX_RATES` de producción.
 */

import { type NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { corsResponse, jsonOk, getAuthUser, isAuthSuccess, corsHeaders } from '../../_helpers'
import { calculateToastPrices } from '@/lib/toast/prices-client'
import {
  UUID_REGEX,
  validateCartLineAgainstMenuV3,
  type FulfillmentChannel,
  type ToastMenuItemV3,
  type ToastModifierGroupV3,
} from '@/lib/toast/menus-v3-contract'

const DELIVERY_ENABLED = process.env.ENABLE_MOBILE_DELIVERY === 'true'

function quoteError(
  message: string,
  status: number,
  code: string,
  extra?: { requestId?: string | null; retryable?: boolean }
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      code,
      requestId: extra?.requestId ?? null,
      retryable: extra?.retryable ?? status >= 500,
    },
    { status, headers: corsHeaders() }
  )
}

export function computeCartHash(params: {
  storeId: number
  channel: 'PICKUP' | 'DELIVERY'
  pickupMethod?: string | null
  items: Array<{
    guid?: string
    itemGuid?: string
    qty?: number
    quantity?: number
    modifiers?: Array<{ guid: string; optionGroupGuid?: string }>
  }>
  tipAmount?: number
  zipCode?: string | null
}): string {
  const normalizedItems = [...params.items]
    .map((item) => ({
      guid: String(item.guid || item.itemGuid || '').trim().toLowerCase(),
      qty: Number(item.qty ?? item.quantity ?? 1),
      modifiers: [...(item.modifiers || [])]
        .map(
          (m) =>
            `${(m.optionGroupGuid || '').trim().toLowerCase()}:${m.guid.trim().toLowerCase()}`
        )
        .sort(),
    }))
    .sort((a, b) => a.guid.localeCompare(b.guid))

  const payload = JSON.stringify({
    storeId: Number(params.storeId),
    channel: params.channel,
    items: normalizedItems,
    tipAmount: Number(Number(params.tipAmount ?? 0).toFixed(2)),
    zipCode: (params.zipCode || '').trim(),
  })

  return crypto.createHash('sha256').update(payload).digest('hex')
}

interface QuoteItemInput {
  guid?: string
  itemGuid?: string
  qty?: number
  quantity?: number
  modifiers?: Array<{
    guid: string
    optionGroupGuid?: string
    name?: string
  }>
  specialInstructions?: string
}

interface QuoteRequestBody {
  storeId: number
  channel: FulfillmentChannel
  pickupSubType?: 'IN_STORE' | 'CURBSIDE'
  items: QuoteItemInput[]
  tipAmount?: number
  deliveryAddress?: {
    street: string
    aptSuite?: string
    city: string
    state: string
    zipCode: string
    latitude: number
    longitude: number
    deliveryInstructions?: string
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authUser = await getAuthUser(request)
    const body = (await request.json()) as QuoteRequestBody
    const {
      storeId,
      channel = 'PICKUP',
      pickupSubType = 'IN_STORE',
      items,
      tipAmount = 0,
      deliveryAddress,
    } = body

    if (!storeId || typeof storeId !== 'number') {
      return quoteError('storeId numérico es requerido', 400, 'VALIDATION_ERROR', {
        retryable: false,
      })
    }

    if (channel !== 'PICKUP' && channel !== 'DELIVERY') {
      return quoteError(
        'channel debe ser PICKUP o DELIVERY',
        400,
        'VALIDATION_ERROR',
        { retryable: false }
      )
    }

    if (channel === 'DELIVERY' && !DELIVERY_ENABLED) {
      return quoteError(
        'El servicio de Delivery nativo se encuentra temporalmente deshabilitado hasta confirmar la configuración contractual oficial con Toast / DoorDash. Por favor selecciona Pickup.',
        409,
        'DELIVERY_DISABLED',
        { retryable: false }
      )
    }

    if (!Array.isArray(items) || items.length === 0) {
      return quoteError(
        'El carrito debe contener al menos un artículo',
        400,
        'VALIDATION_ERROR',
        { retryable: false }
      )
    }

    const { data: store, error: storeErr } = await supabaseAdmin
      .from('stores')
      .select('id, name, address, phone, external_id')
      .eq('id', storeId)
      .single()

    if (storeErr || !store) {
      return quoteError(
        `Sucursal #${storeId} no encontrada`,
        404,
        'VALIDATION_ERROR',
        { retryable: false }
      )
    }

    const normalizedInputItems = items.map((reqItem) => ({
      guid: String(reqItem.guid || reqItem.itemGuid || '').trim(),
      qty: Number(reqItem.qty ?? reqItem.quantity ?? 0),
      modifiers: reqItem.modifiers || [],
      specialInstructions: reqItem.specialInstructions,
    }))

    for (const reqItem of normalizedInputItems) {
      if (!reqItem.guid || !UUID_REGEX.test(String(reqItem.guid))) {
        return quoteError(
          `GUID de artículo inválido: "${String(reqItem.guid)}"`,
          400,
          'VALIDATION_ERROR',
          { retryable: false }
        )
      }
      if (!Number.isInteger(reqItem.qty) || reqItem.qty <= 0 || reqItem.qty > 99) {
        return quoteError(
          `Cantidad inválida para el artículo ${reqItem.guid}. Debe ser un entero entre 1 y 99.`,
          400,
          'VALIDATION_ERROR',
          { retryable: false }
        )
      }
    }

    const itemGuids = Array.from(new Set(normalizedInputItems.map((i) => i.guid)))

    const { data: menuRows, error: menuErr } = await supabaseAdmin
      .from('app_menu_cache')
      .select(
        'toast_item_guid, name, price, is_available, modifier_groups_json'
      )
      .eq('store_id', storeId)
      .in('toast_item_guid', itemGuids)

    if (menuErr) {
      return quoteError(
        'Error consultando catálogo de menú de la sucursal',
        500,
        'BACKEND_UNAVAILABLE',
        { retryable: true }
      )
    }

    const menuItemMap = new Map<
      string,
      {
        menuItemV3: ToastMenuItemV3
        groupsMap: Record<string, ToastModifierGroupV3>
      }
    >()

    for (const row of menuRows || []) {
      const rawGroups = Array.isArray(row.modifier_groups_json)
        ? row.modifier_groups_json
        : []
      const groupsMap: Record<string, ToastModifierGroupV3> = {}
      const groupGuids: string[] = []

      for (const grp of rawGroups) {
        if (!grp || !grp.guid || !grp.name) continue
        const minSel = Number(grp.minSelections ?? 0)
        const maxSel = Number(grp.maxSelections ?? 10)
        groupsMap[grp.guid] = {
          guid: String(grp.guid),
          name: String(grp.name),
          minSelections: minSel,
          maxSelections: maxSel,
          required: minSel > 0 || Boolean(grp.required),
          isMultiSelect: maxSel > 1,
          options: (Array.isArray(grp.options) ? grp.options : []).map(
            (opt: { guid?: string; name?: string; price?: number }) => ({
              guid: String(opt.guid || ''),
              name: String(opt.name || ''),
              price: Number(opt.price || 0),
              isAvailable: true,
              isDefault: false,
            })
          ),
        }
        groupGuids.push(String(grp.guid))
      }

      menuItemMap.set(row.toast_item_guid, {
        menuItemV3: {
          guid: row.toast_item_guid,
          name: row.name,
          description: null,
          basePrice: Number(row.price),
          imageUrl: null,
          isAvailable: Boolean(row.is_available),
          visibility: ['PICKUP', 'DELIVERY'],
          modifierGroupGuids: groupGuids,
        },
        groupsMap,
      })
    }

    let catalogSubtotal = 0
    const validatedItems: Array<{
      guid: string
      name: string
      qty: number
      basePrice: number
      modifiers: Array<{
        guid: string
        optionGroupGuid: string
        name: string
        price: number
      }>
      unitPrice: number
      lineTotal: number
      specialInstructions?: string
    }> = []

    for (const reqItem of normalizedInputItems) {
      const entry = menuItemMap.get(reqItem.guid)
      if (!entry) {
        return quoteError(
          `El artículo ${reqItem.guid} no existe en el menú de ${store.name}`,
          400,
          'VALIDATION_ERROR',
          { retryable: false }
        )
      }

      const validation = validateCartLineAgainstMenuV3(
        entry.menuItemV3,
        entry.groupsMap,
        (reqItem.modifiers || []).map((m) => ({
          optionGuid: m.guid,
          groupGuid: m.optionGroupGuid,
        })),
        channel,
        reqItem.qty
      )

      if (!validation.valid || !validation.resolvedItem) {
        return quoteError(
          validation.errors[0] || 'Selección de modificadores inválida',
          400,
          validation.code || 'VALIDATION_ERROR',
          { retryable: false }
        )
      }

      catalogSubtotal += validation.resolvedItem.lineTotal
      validatedItems.push({
        guid: validation.resolvedItem.guid,
        name: validation.resolvedItem.name,
        qty: reqItem.qty,
        basePrice: validation.resolvedItem.basePrice,
        modifiers: validation.resolvedItem.modifiers,
        unitPrice: validation.resolvedItem.unitPrice,
        lineTotal: validation.resolvedItem.lineTotal,
        specialInstructions: reqItem.specialInstructions?.trim() || undefined,
      })
    }

    catalogSubtotal = Math.round(catalogSubtotal * 100) / 100
    const requestedTip = Math.max(0, Math.round(Number(tipAmount || 0) * 100) / 100)

    const cartHash = computeCartHash({
      storeId,
      channel,
      items: validatedItems.map((i) => ({
        guid: i.guid,
        qty: i.qty,
        modifiers: i.modifiers.map((m) => ({
          guid: m.guid,
          optionGroupGuid: m.optionGroupGuid,
        })),
      })),
      tipAmount: requestedTip,
      zipCode: channel === 'DELIVERY' ? deliveryAddress?.zipCode : null,
    })

    const toastSelections = validatedItems.map((i, idx) => ({
      itemGuid: i.guid,
      quantity: i.qty,
      externalId: `quote:${cartHash.slice(0, 12)}:line:${idx}`,
      modifiers: i.modifiers.map((m, modIdx) => ({
        guid: m.guid,
        optionGroupGuid: m.optionGroupGuid,
        quantity: 1,
        externalId: `quote:${cartHash.slice(0, 12)}:line:${idx}:mod:${modIdx}`,
      })),
    }))

    const toastPricesResp = await calculateToastPrices(store.external_id, {
      channel,
      selections: toastSelections,
      tipAmount: requestedTip,
      orderExternalId: `quote:${cartHash.slice(0, 16)}`,
      deliveryAddress:
        channel === 'DELIVERY' && deliveryAddress ? deliveryAddress : undefined,
    })

    // Caso 1: Toast POS devuelve HTTP 403 / code 10010 (TOAST_SCOPE_BLOCKED)
    if (!toastPricesResp.ok && toastPricesResp.status === 'BLOCKED_EXTERNALLY') {
      return jsonOk({
        ok: false,
        code: 'TOAST_SCOPE_BLOCKED',
        quoteId: null,
        priceSource: 'blocked_external',
        requestId: toastPricesResp.requestId,
        retryable: false,
        toastStatus: toastPricesResp.blocked,
        store: {
          id: store.id,
          name: store.name,
          address: store.address,
          phone: store.phone,
        },
        channel,
        pickupSubType: channel === 'PICKUP' ? pickupSubType : null,
        items: validatedItems,
        estimatedReference: {
          catalogSubtotal,
          tipAmount: requestedTip,
          currency: 'USD',
          nonPayableEstimate: true,
          disclaimer:
            'Subtotal informativo de catálogo (no pagable). Los impuestos, recargos y total comprable se calculan exclusivamente en Toast POS (/orders/v2/prices) cuando se habiliten los permisos de escritura.',
        },
      })
    }

    // Caso 2: Error técnico / timeout en Toast API
    if (!toastPricesResp.ok) {
      return quoteError(
        toastPricesResp.error ||
          'No se pudo obtener el cálculo de precios desde Toast POS.',
        toastPricesResp.httpStatus >= 500 ? 502 : 422,
        toastPricesResp.code || 'TOAST_API_ERROR',
        {
          requestId: toastPricesResp.requestId,
          retryable: toastPricesResp.retryable,
        }
      )
    }

    // Caso 3: Toast /orders/v2/prices respondió con cálculo autoritativo
    const authResult = toastPricesResp.result

    const authenticatedUserId = isAuthSuccess(authUser) ? authUser.userId : null

    if (authenticatedUserId) {
      try {
        await supabaseAdmin
          .from('app_quotes')
          .update({ status: 'EXPIRED' })
          .eq('user_id', authenticatedUserId)
          .eq('store_id', storeId)
          .eq('status', 'OPEN')
      } catch (expireErr) {
        console.warn('[mobile/order/quote] Error expirando quotes previas:', expireErr)
      }
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    // Verificar si el usuario autenticado ya tiene fila en app_users (sin inventar datos falsos)
    let validAppUserId: string | null = null
    if (authenticatedUserId) {
      const { data: existingProfile } = await supabaseAdmin
        .from('app_users')
        .select('id')
        .eq('id', authenticatedUserId)
        .maybeSingle()
      if (existingProfile?.id) {
        validAppUserId = existingProfile.id
      }
    }

    const { data: savedQuote, error: quoteInsertErr } = await supabaseAdmin
      .from('app_quotes')
      .insert({
        user_id: validAppUserId,
        store_id: storeId,
        channel,
        pickup_method: pickupSubType === 'CURBSIDE' ? 'curbside' : 'in_store',
        delivery_address:
          channel === 'DELIVERY' && deliveryAddress ? deliveryAddress : null,
        items_json: validatedItems,
        subtotal: authResult.subtotal,
        tax_rate: 0,
        tax_amount: authResult.taxTotal,
        delivery_fee: authResult.deliveryFee,
        tip_amount: authResult.tipTotal,
        discount_amount: authResult.discountTotal,
        total_amount: authResult.totalAmount,
        currency: 'USD',
        price_version: 'v2',
        cart_hash: cartHash,
        price_source: 'toast_prices',
        status: 'OPEN',
        expires_at: expiresAt,
      })
      .select('id, expires_at')
      .single()

    if (quoteInsertErr || !savedQuote) {
      console.error('❌ [mobile/order/quote] Error guardando quote:', quoteInsertErr)
      return quoteError(
        'No se pudo registrar la cotización autoritativa en base de datos.',
        500,
        'BACKEND_UNAVAILABLE',
        { retryable: true }
      )
    }

    return jsonOk({
      ok: true,
      quoteId: savedQuote.id,
      priceSource: 'toast_prices',
      requestId: toastPricesResp.requestId,
      retryable: false,
      store: {
        id: store.id,
        name: store.name,
        address: store.address,
        phone: store.phone,
      },
      channel,
      pickupSubType: channel === 'PICKUP' ? pickupSubType : null,
      items: validatedItems,
      financials: {
        subtotal: authResult.subtotal,
        taxAmount: authResult.taxTotal,
        serviceChargeTotal: authResult.serviceChargeTotal,
        deliveryFee: authResult.deliveryFee,
        tipAmount: authResult.tipTotal,
        discountAmount: authResult.discountTotal,
        totalAmount: authResult.totalAmount,
        currency: 'USD',
      },
      cartHash,
      expiresAt: savedQuote.expires_at,
    })
  } catch (err) {
    console.error('❌ [mobile/order/quote] Error:', err)
    return quoteError(
      'Error interno al calcular cotización',
      500,
      'BACKEND_UNAVAILABLE',
      { retryable: true }
    )
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

/**
 * @module api/order-ready/webhook
 * @description Toast POS Webhook receiver for real-time order fulfillment events (e.g. KDS expediter double-tap).
 * 
 * @businessRules
 * - **Trigger del KDS**: Toast NO emite webhook al hacer doble tap (verificado con datos reales); el cierre se detecta por polling en
 *   `lib/order-ready-sync.ts` desde GET /api/order-ready/orders. Este webhook `order_updated` registra la orden al instante (IN_PROGRESS)
 *   y, si el payload ya trae platillos READY, la clasifica con la misma lógica (`evaluateToastOrder`).
 * - **Filtro de Dining Options**: Identifica órdenes de mostrador / comer aquí ('FOR_HERE') y para llevar ('TOGO'). Descarta o etiqueta delivery ('DELIVERY') para control de audio.
 * - **Mapeo de Tiendas**: Traduce el `restaurantExternalId` de Toast al código de sucursal de Tacos Gavilan (ej. Lynwood, Bell, etc.).
 * 
 * @dataFlow
 * - Toast Webhook POST -> /api/order-ready/webhook -> Valida y procesa -> Upsert en Supabase (order_ready_announcements) -> Supabase Realtime -> Order Ready Board (Audio Announcer)
 * 
 * @notes
 * - Idempotente: procesa duplicados sin duplicar registros en base de datos.
 * - Soporta RECALL de Toast KDS: si una orden READY se desmarca en KDS, regresa a IN_PROGRESS para reaparecer en la tableta del preparador.
 * - KDS bump silencioso: al pasar a READY por KDS, se persiste `announced = true` para evitar anuncios automáticos por altavoz.
 * - `ready_at` usa la hora real del bump (modifiedDate de los platillos).
 * - FIX (2026-10-22): el SELECT previo incluye `items_summary` y `ready_at`; `updateData` construye únicamente cambios semánticos reales usando `areOrderItemsSummariesEqual()` y omite ejecutar `UPDATE` si `updateData` está vacío.
 * - FIX (2026-11-09, Paridad 1:1 con Toast KDS): prioriza `evaluation.sentAt` / `orderObj.createdDate` sobre `openedDate`, y reconcilia `created_at` en registros existentes cuando llega el timestamp autoritativo de disparo a cocina (`sentAtAuthoritative`).
 * - FIX (2026-11-20, Escudo Anti-Falso-Recall por Webhook Tardío — La Puente #228): bloquea transiciones `READY -> IN_PROGRESS` (y `COMPLETED -> IN_PROGRESS` sin ítems) cuando el webhook `order_updated` carece de `selections` (`evaluation.activeItems === 0`) o cuando su timestamp de modificación (`getLatestToastOrderSnapshotMs`) es anterior o igual al bump real del KDS (`existing.ready_at`), preservando intacto el RECALL legítimo en KDS (`latestSnapshotMs > existingReadyMs`).
 * - BLINDAJE CRIPTOGRÁFICO Y ANTI-SPOOFING WEBHOOK (2026-11-21): cuando `TOAST_WEBHOOK_SECRET` está configurado valida `Toast-Signature` HMAC-SHA256 / Bearer con `crypto.timingSafeEqual`; cuando no está configurado en entorno, exige `restaurantGuid` oficial en `TOAST_STORE_MAP` + `orderGuid` UUID válido y verifica/hidrata la orden directamente contra la API oficial de Toast (`ws-api.toasttab.com`) antes de tocar Supabase (cero downtime en producción y cero inyección de órdenes falsas).
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/auth-server'
import { getAuthToken } from '@/lib/toast-api'
import { TOAST_STORE_MAP, STORE_GUID_BY_CODE, evaluateToastOrder, classifyDiningName, getDiningMap, extractOrderItemsSummary, areOrderItemsSummariesEqual, getLatestToastOrderSnapshotMs } from '@/lib/order-ready-sync'
import { getCaliforniaBusinessDate } from '@/lib/business-date'

function getToastApiHost(): string {
  return process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'
}

function safeTimingEqualStrings(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    const ha = createHash('sha256').update(bufA).digest()
    const hb = createHash('sha256').update(bufB).digest()
    timingSafeEqual(ha, hb)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

function verifyToastWebhookRequest(request: Request, rawBody: string, secret: string): boolean {
  const rawSig = (request.headers.get('toast-signature') || request.headers.get('Toast-Signature') || '').trim()
  if (rawSig) {
    const cleanedSig = rawSig.replace(/^(?:sha256=|v1=)/i, '').trim()
    const expectedHex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    const expectedBase64 = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
    if (safeTimingEqualStrings(cleanedSig.toLowerCase(), expectedHex.toLowerCase()) || safeTimingEqualStrings(cleanedSig, expectedBase64)) {
      return true
    }
  }

  const authHeader = (request.headers.get('authorization') || request.headers.get('Authorization') || '').trim()
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim()
    if (safeTimingEqualStrings(bearer, secret)) {
      return true
    }
  }

  return false
}

export const dynamic = 'force-dynamic'

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const clientIp =
      (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || 'unknown')
        .split(',')[0]
        .trim() || 'unknown'
    const rl = checkRateLimit(`order-ready-webhook:${clientIp}`, 240, 60_000)
    if (rl.limited) {
      return NextResponse.json({ error: 'Too many webhook requests' }, { status: 429 })
    }

    const rawBody = await request.text()
    const webhookSecret = (process.env.TOAST_WEBHOOK_SECRET || '').trim()
    if (webhookSecret) {
      if (!verifyToastWebhookRequest(request, rawBody, webhookSecret)) {
        return NextResponse.json(
          { error: 'No autorizado: firma Toast-Signature o token inválido' },
          { status: 401 }
        )
      }
    }

    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 })
    }

    // Soporte para estructura Toast { details: { order, restaurantGuid } } o directo { order }
    let orderObj = payload?.details?.order || payload?.order || payload || {}
    const restaurantId = String(
      payload?.restaurantGuid ||
        payload?.details?.restaurantGuid ||
        payload?.restaurantId ||
        payload?.restaurantExternalId ||
        payload?.storeId ||
        ''
    ).trim()
    let orderGuid = String(
      payload?.details?.orderGuid || payload?.orderGuid || orderObj?.guid || payload?.guid || ''
    ).trim()

    // Si TOAST_WEBHOOK_SECRET no está configurado en Vercel, verificamos criptográficamente el evento
    // consultando la orden real directo en la API oficial de Toast (cero órdenes falsas y cero downtime).
    if (!webhookSecret) {
      if (
        !restaurantId ||
        !Object.prototype.hasOwnProperty.call(TOAST_STORE_MAP, restaurantId) ||
        !UUID_V4_REGEX.test(orderGuid)
      ) {
        return NextResponse.json(
          { error: 'No autorizado: se requiere restaurantGuid oficial y orderGuid UUID válido' },
          { status: 401 }
        )
      }

      const toastToken = await getAuthToken()
      if (!toastToken) {
        return NextResponse.json({ error: 'Servicio Toast temporalmente no disponible' }, { status: 503 })
      }

      const verifyRes = await fetch(`${getToastApiHost()}/orders/v2/orders/${orderGuid}`, {
        headers: {
          Authorization: `Bearer ${toastToken}`,
          'Toast-Restaurant-External-ID': restaurantId,
        },
      })
      if (!verifyRes.ok) {
        return NextResponse.json(
          { error: 'No autorizado: orden no verificada en Toast POS API' },
          { status: 401 }
        )
      }

      const verifiedToastOrder = await verifyRes.json().catch(() => null)
      if (!verifiedToastOrder || String(verifiedToastOrder.guid || '').toLowerCase() !== orderGuid.toLowerCase()) {
        return NextResponse.json(
          { error: 'No autorizado: respuesta de orden Toast inválida' },
          { status: 401 }
        )
      }

      // Usar exclusivamente el objeto autoritativo de Toast API (nunca confiar en campos del body no firmado)
      orderObj = verifiedToastOrder
      orderGuid = String(verifiedToastOrder.guid)
      payload = {
        restaurantGuid: restaurantId,
        details: {
          restaurantGuid: restaurantId,
          orderGuid,
          order: verifiedToastOrder,
        },
      }
    }

    const explicitTestStoreCode =
      Boolean(webhookSecret) &&
      process.env.ALLOW_ORDER_READY_TEST_DB === 'true' &&
      typeof payload.storeCode === 'string' &&
      payload.storeCode.toUpperCase().startsWith('CODEX_ORDER_READY_TEST')
        ? payload.storeCode.toUpperCase()
        : null
    const storeInfo = explicitTestStoreCode
      ? { code: explicitTestStoreCode, name: payload.storeName || explicitTestStoreCode }
      : TOAST_STORE_MAP[restaurantId] || { code: 'LYNWOOD', name: 'Lynwood' }

    // El número de orden puede venir en varios formatos
    const orderNumber = orderObj.displayNumber || orderObj.orderNumber || payload.orderNumber || payload.displayNumber || payload.ticketNumber
    const rawStatus = (payload.details?.guestOrderStatus || payload.guestOrderStatus || orderObj.fulfillmentStatus || payload.status || orderObj.approvalStatus || '').toString().toUpperCase()

    if (!orderNumber && !orderGuid) {
      return NextResponse.json({ message: 'Payload recibido sin orderNumber ni orderGuid, ignorado' }, { status: 200 })
    }

    // Estado: misma lógica que el sync activo (platillos de cocina con fulfillmentStatus READY = doble tap del KDS).
    // Si el payload incluye selections (evaluation.activeItems > 0), evaluateToastOrder es la fuente autoritativa
    // y nunca debe ser sobrescrita a READY mientras existan platillos de cocina en SENT.
    // Si el payload SÍ trae selections (hasRawSelections = true) pero evaluation.activeItems === 0,
    // significa que el 100% de los ítems son Gift Cards / recargas (Add Value ($)) o anulados, por lo que permanece COMPLETED.
    const hasRawSelections = Array.isArray(orderObj.checks)
      ? orderObj.checks.some((c: any) => Array.isArray(c?.selections) && c.selections.length > 0)
      : Array.isArray(orderObj.selections) && orderObj.selections.length > 0

    const evaluation = evaluateToastOrder(orderObj)
    let status: 'IN_PROGRESS' | 'READY' | 'COMPLETED' = evaluation.status
    if (rawStatus === 'VOIDED') {
      status = 'COMPLETED'
    } else if (evaluation.activeItems === 0 && !hasRawSelections) {
      if (rawStatus === 'READY_FOR_PICKUP' || rawStatus === 'READY' || rawStatus === 'FULFILLED') {
        status = 'READY'
      } else if (rawStatus === 'IN_PROGRESS' || rawStatus === 'SENT' || rawStatus === 'OPEN') {
        status = 'IN_PROGRESS'
      }
    }

    // Traducir Dining Option usando Toast Dining Map dinámico
    const diningGuid =
      orderObj.diningOption?.guid ||
      orderObj.diningOption?.id ||
      orderObj.checks?.[0]?.diningOption?.guid ||
      (typeof orderObj.diningOption === 'string' && /^[0-9a-f-]{36}$/i.test(orderObj.diningOption) ? orderObj.diningOption : null) ||
      (typeof payload.diningOption === 'string' && /^[0-9a-f-]{36}$/i.test(payload.diningOption) ? payload.diningOption : null)

    let diningName = ''
    if (orderObj.diningOption?.name) {
      diningName = orderObj.diningOption.name
    } else if (diningGuid) {
      try {
        const token = await getAuthToken()
        if (token) {
          const rId = String(restaurantId || STORE_GUID_BY_CODE[storeInfo.code] || '')
          const diningMap = await getDiningMap(token, rId)
          diningName = diningMap[diningGuid] || ''
        }
      } catch (e) {
        console.warn('Webhook dining map lookup error:', e)
      }
    } else if (typeof orderObj.diningOption === 'string') {
      diningName = orderObj.diningOption
    } else if (typeof payload.diningOption === 'string') {
      diningName = payload.diningOption
    }

    const diningOption = classifyDiningName(diningName, orderObj)

    // REGLA CRÍTICA: El Order Ready Board es EXCLUSIVO para COMEDOR (FOR_HERE) y PARA LLEVAR (TOGO).
    // Las órdenes de Drive-Thru y Delivery de plataformas se descartan por completo de este tablero.
    if (diningOption === 'DRIVE_THRU' || diningOption === 'DELIVERY') {
      if (orderGuid) {
        await supabaseAdmin.from('order_ready_announcements').delete().eq('order_guid', orderGuid)
      }
      return NextResponse.json({
        success: true,
        action: 'ignored',
        reason: `Canal excluido del Order Ready Board (${diningOption})`,
        orderNumber
      })
    }

    // FAIL-CLOSED: si no se pudo resolver el canal, NO se inserta ni actualiza (el sync activo la registra ya verificada)
    if (diningOption === 'UNKNOWN') {
      return NextResponse.json({ success: true, action: 'ignored', reason: 'Canal no resuelto (fail-closed)', orderNumber })
    }

    let customerName = orderObj.customer?.firstName || payload.customerName || null
    const now = new Date().toISOString()

    // 1. Buscar si ya existe la orden en Supabase por order_guid (clave canónica de Toast)
    let existing: any = null
    if (orderGuid) {
      const { data: byGuid } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('id, status, announced, order_number, dining_option, customer_name, order_guid, items_summary, ready_at, created_at, business_date')
        .eq('order_guid', orderGuid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      existing = byGuid
    }

    const orderDate =
      evaluation.sentAt ||
      orderObj.createdDate ||
      orderObj.checks?.[0]?.createdDate ||
      orderObj.paidDate ||
      orderObj.openedDate ||
      now
    const currentBusinessDate = getCaliforniaBusinessDate(orderDate)

    // 2. Si no se encontró por GUID pero tenemos orderNumber, buscar por store_code + order_number + business_date
    if (!existing && orderNumber) {
      const { data: byNum } = await supabaseAdmin
        .from('order_ready_announcements')
        .select('id, status, announced, order_number, dining_option, customer_name, order_guid, items_summary, ready_at, created_at, business_date')
        .eq('store_code', storeInfo.code)
        .eq('business_date', currentBusinessDate)
        .eq('order_number', String(orderNumber))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      existing = byNum
    }

    // Si ya existe la orden, actualizarla solo si cambió algún campo real
    if (existing) {
      const itemsSummary = extractOrderItemsSummary(orderObj)
      const existingReadyMs = Date.parse(existing.ready_at || '')
      const latestSnapshotMs = getLatestToastOrderSnapshotMs(orderObj)
      const isAttemptedRecall = existing.status === 'READY' && status === 'IN_PROGRESS'
      // Escudo contra falso RECALL por webhook atrasado/reintentado de cobro previo al bump de KDS o webhook sin selections:
      const isStaleOrEmptyRecall =
        isAttemptedRecall &&
        (evaluation.activeItems === 0 ||
          (Number.isFinite(existingReadyMs) &&
            Number.isFinite(latestSnapshotMs) &&
            latestSnapshotMs <= existingReadyMs + 500))
      const isEmptyReopenAfterComplete =
        existing.status === 'COMPLETED' && status === 'IN_PROGRESS' && evaluation.activeItems === 0

      const isRecall = isAttemptedRecall && !isStaleOrEmptyRecall
      const isKdsBump = existing.status === 'IN_PROGRESS' && status === 'READY'
      const nextStatus = isStaleOrEmptyRecall
        ? 'READY'
        : isEmptyReopenAfterComplete
          ? 'COMPLETED'
          : isRecall
            ? 'IN_PROGRESS'
            : isKdsBump
              ? 'READY'
              : status

      const updateData: any = {}
      if (existing.status !== nextStatus) {
        updateData.status = nextStatus
      }
      if (existing.dining_option !== diningOption) {
        updateData.dining_option = diningOption
      }
      if (
        itemsSummary &&
        (!existing.items_summary ||
          (!isStaleOrEmptyRecall && !areOrderItemsSummariesEqual(existing.items_summary, itemsSummary)))
      ) {
        updateData.items_summary = itemsSummary
      }
      if (evaluation.sentAt && evaluation.sentAtAuthoritative) {
        const oldCreatedMs = Date.parse(existing.created_at || '')
        const newSentMs = Date.parse(evaluation.sentAt)
        if (Number.isFinite(newSentMs) && (!Number.isFinite(oldCreatedMs) || Math.abs(newSentMs - oldCreatedMs) > 1000)) {
          updateData.created_at = evaluation.sentAt
          const reconciledBDate = getCaliforniaBusinessDate(evaluation.sentAt)
          if (existing.business_date !== reconciledBDate) {
            updateData.business_date = reconciledBDate
          }
        }
      }
      if (isKdsBump) {
        updateData.ready_at = evaluation.readyAt || now
        // Regla de Negocio Tacos Gavilan: El bump en KDS NO emite voz automática por altavoz
        updateData.announced = true
      } else if (isRecall) {
        // RECALL en Toast KDS: vuelve a preparación, se limpia ready_at y reaparece en tableta preparador
        updateData.ready_at = null
        updateData.announced = false
      } else if (existing.status === 'READY' && nextStatus === 'READY' && evaluation.readyAt) {
        const oldReadyMs = Date.parse(existing.ready_at || '')
        const newReadyMs = Date.parse(evaluation.readyAt)
        if (Number.isFinite(newReadyMs) && (!Number.isFinite(oldReadyMs) || Math.abs(newReadyMs - oldReadyMs) > 1000)) {
          updateData.ready_at = evaluation.readyAt
        }
      }
      if (customerName && existing.customer_name !== customerName) {
        updateData.customer_name = customerName
      }
      if (orderGuid && !existing.order_guid) {
        updateData.order_guid = orderGuid
      }

      if (Object.keys(updateData).length > 0) {
        await supabaseAdmin
          .from('order_ready_announcements')
          .update(updateData)
          .eq('id', existing.id)
      }

      return NextResponse.json({ success: true, action: Object.keys(updateData).length > 0 ? 'updated' : 'unchanged', orderNumber: existing.order_number, status: nextStatus })
    }

    // Si es orden nueva y no tenemos número de orden pero sí GUID, consultar a Toast API
    let finalOrderNumber = orderNumber ? String(orderNumber) : null
    let finalDiningOption: ReturnType<typeof classifyDiningName> = diningOption

    let fetchedToastOrder: any = null
    if (!finalOrderNumber && orderGuid && restaurantId) {
      try {
        const token = await getAuthToken()
        if (token) {
          const res = await fetch(`${getToastApiHost()}/orders/v2/orders/${orderGuid}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Toast-Restaurant-External-ID': restaurantId
            }
          })
          if (res.ok) {
            fetchedToastOrder = await res.json()
            if (fetchedToastOrder.displayNumber) {
              finalOrderNumber = String(fetchedToastOrder.displayNumber)
            }
            if (fetchedToastOrder.diningOption?.guid || fetchedToastOrder.diningOption?.name) {
              const rId = String(restaurantId || STORE_GUID_BY_CODE[storeInfo.code] || '')
              const diningMap = await getDiningMap(token, rId)
              const dGuid = String(fetchedToastOrder.diningOption?.guid || '')
              const dName = diningMap[dGuid] || fetchedToastOrder.diningOption?.name || ''
              finalDiningOption = classifyDiningName(dName, fetchedToastOrder)
            }
            if (fetchedToastOrder.customer?.firstName && !customerName) {
              customerName = fetchedToastOrder.customer.firstName
            }
          }
        }
      } catch (err) {
        console.warn('Toast order fetch fallback error:', err)
      }
    }

    if (finalDiningOption === 'DRIVE_THRU' || finalDiningOption === 'DELIVERY' || finalDiningOption === 'UNKNOWN') {
      return NextResponse.json({ success: true, action: 'ignored', reason: `Canal excluido (${finalDiningOption})` })
    }

    // Si la orden no existía y está en COMPLETED (o es un borrador no enviado a cocina), no se inserta
    if (status === 'COMPLETED') {
      return NextResponse.json({ success: true, action: 'ignored', status })
    }

    if (!finalOrderNumber) {
      finalOrderNumber = String(orderGuid?.slice(-4) || '---')
    }

    const itemsSummary = extractOrderItemsSummary(orderObj) || (fetchedToastOrder ? extractOrderItemsSummary(fetchedToastOrder) : null)
    const fetchedEval = fetchedToastOrder ? evaluateToastOrder(fetchedToastOrder) : null
    const effectiveOrderDate =
      evaluation.sentAt ||
      fetchedEval?.sentAt ||
      orderObj.createdDate ||
      fetchedToastOrder?.createdDate ||
      orderObj.checks?.[0]?.createdDate ||
      fetchedToastOrder?.checks?.[0]?.createdDate ||
      orderObj.paidDate ||
      fetchedToastOrder?.paidDate ||
      orderObj.openedDate ||
      fetchedToastOrder?.openedDate ||
      now
    const effectiveBusinessDate = getCaliforniaBusinessDate(effectiveOrderDate)

    // Insertar o actualizar registro en Supabase (evitar duplicados con onConflict)
    if (orderGuid) {
      await supabaseAdmin.from('order_ready_announcements').upsert({
        store_code: storeInfo.code,
        store_id: restaurantId || storeInfo.code,
        store_name: storeInfo?.name || storeInfo.code,
        order_number: finalOrderNumber,
        order_guid: orderGuid,
        dining_option: finalDiningOption,
        customer_name: customerName,
        status,
        business_date: effectiveBusinessDate,
        announced: status === 'READY' ? true : false,
        ready_at: status === 'READY' ? (evaluation.readyAt || fetchedEval?.readyAt || now) : null,
        items_summary: itemsSummary,
        created_at: effectiveOrderDate
      }, { onConflict: 'order_guid' })
    } else {
      await supabaseAdmin.from('order_ready_announcements').insert({
        store_code: storeInfo.code,
        store_id: restaurantId || storeInfo.code,
        store_name: storeInfo?.name || storeInfo.code,
        order_number: finalOrderNumber,
        order_guid: null,
        dining_option: finalDiningOption,
        customer_name: customerName,
        status,
        business_date: effectiveBusinessDate,
        announced: status === 'READY' ? true : false,
        ready_at: status === 'READY' ? (evaluation.readyAt || fetchedEval?.readyAt || now) : null,
        items_summary: itemsSummary,
        created_at: effectiveOrderDate
      })
    }

    return NextResponse.json({ success: true, action: 'created', orderNumber: finalOrderNumber, status })
  } catch (err: any) {
    console.error('Error procesando webhook de Toast:', err)
    return NextResponse.json({ error: err.message || 'Webhook processing failed' }, { status: 500 })
  }
}

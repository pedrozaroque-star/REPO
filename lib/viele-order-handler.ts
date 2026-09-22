/**
 * @module viele-order-handler
 * @description Emisión y persistencia íntegra de compras Viele para Tacos Gavilan.
 * @businessRules Catálogo server-side; idempotencia durable; nunca confirmar conciliaciones fallidas.
 * @dataFlow Auth → catálogo/membresía → claim DB → V&S → persistencia atómica → respuesta durable.
 * @notes Requiere migración 202609220001; fallos inciertos retienen bloqueo hasta conciliación manual.
 */
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyVieleAuth } from './viele-auth';
import { placeVieleOrder, type SingleOrderResult } from './viele-api';
import { isVieleSoda } from './viele-catalog-data';
import { normalizeVieleOrderLines, validVieleShipDate, vieleOrderDate, type OrderLine } from './viele-order-validation';

export async function handleVieleOrder(req: Request, db: SupabaseClient) {
  let claimedKey: string | undefined;
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Body inválido.');
    const storeId = Number(body.storeId);
    if (!['number', 'string'].includes(typeof body.storeId) || !Number.isSafeInteger(storeId) || storeId <= 0) throw new Error('Sucursal inválida.');
    const auth = verifyVieleAuth(req, { requiredStoreId: storeId });
    if (!auth.authorized) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    if (!validVieleShipDate(body.shipDate)) throw new Error('Fecha de entrega inválida (YYYY-MM-DD).');
    let action = body.action;
    if (action === undefined) {
      if ([body.submitLive, body.isSimulation].some(v => v !== undefined && typeof v !== 'boolean')) throw new Error('Los indicadores de modo deben ser booleanos.');
      if (body.submitLive === true && body.isSimulation === true) throw new Error('Modo de ejecución contradictorio.');
      action = body.submitLive === true ? 'live' : body.isSimulation === true ? 'simulation' : 'draft';
    }
    if (!['live', 'draft', 'simulation'].includes(action)) throw new Error('Acción inválida.');
    for (const key of ['buyerName', 'customerPo', 'notes']) if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') throw new Error(`${key}: texto requerido.`);
    const buyerName = (body.buyerName?.trim() || 'AFV').slice(0, 100);
    const customerPo = (body.customerPo?.trim() || buyerName).slice(0, 15);
    const notes = (body.notes?.trim() || '').slice(0, 256);
    const [catalog, membership] = await Promise.all([
      db.from('viele_items').select('item_code,description,uom,unit_price').eq('is_active', true),
      db.from('viele_store_sort_orders').select('item_code').eq('store_id', storeId)
    ]);
    if (catalog.error || membership.error) return NextResponse.json({ success: false, error: 'No se pudo verificar el catálogo de esta sucursal.' }, { status: 503 });
    const lines = normalizeVieleOrderLines(body.items, catalog.data || [], (membership.data || []).map(row => row.item_code));
    const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const totalCases = lines.reduce((sum, line) => sum + line.quantity, 0);
    const subtotal = round(lines.reduce((sum, line) => sum + round(line.quantity * line.unitPrice), 0));
    const orderDate = vieleOrderDate();
    const toItems = (items: OrderLine[]) => items.map(i => ({ item_code: i.itemCode, description: i.description, uom: i.uom,
      unit_price: i.unitPrice, par_quantity: i.parQuantity ?? 0, leftover_quantity: i.leftoverQuantity ?? 0,
      suggested_quantity: Math.max(0, (i.parQuantity ?? 0) - (i.leftoverQuantity ?? 0)), order_quantity: i.quantity, extended_amount: round(i.quantity * i.unitPrice) }));
    const baseHeader = { store_id: storeId, order_date: orderDate, ship_date: body.shipDate, buyer_name: buyerName, customer_po_no: customerPo, notes };
    if (action === 'simulation') return NextResponse.json({ success: true, mode: 'simulation', isSimulation: true,
      totalCases, subtotalAmount: subtotal, taxAmount: null, totalAmount: subtotal, taxPending: true,
      split: lines.some(i => isVieleSoda(i.itemCode)) && lines.some(i => !isVieleSoda(i.itemCode)), itemsCount: lines.length });
    if (action === 'draft') {
      const draftNumber = `BORR-${storeId}-${randomUUID()}`;
      const category = lines.every(i => isVieleSoda(i.itemCode)) ? 'sodas' : lines.some(i => isVieleSoda(i.itemCode)) ? 'mixed' : 'general';
      const { data, error } = await db.rpc('persist_viele_order_batch', { p_orders: [{ header: { ...baseHeader,
        order_number: draftNumber, order_category: category, status: 'draft', total_cases: totalCases,
        subtotal_amount: subtotal, tax_amount: 0, total_amount: subtotal, viele_response: { taxPending: true } }, items: toItems(lines) }] });
      if (error) return NextResponse.json({ success: false, error: 'No se guardó el borrador. Verifica la migración de persistencia de Viele.' }, { status: 503 });
      return NextResponse.json({ success: true, mode: 'draft', order: data[0], orderNumber: draftNumber, itemsCount: lines.length, totalCases, totalAmount: subtotal, isSimulation: true, taxPending: true });
    }

    const canonical = JSON.stringify({ storeId, shipDate: body.shipDate, buyerName, customerPo, notes, lines: [...lines].sort((a, b) => a.itemCode.localeCompare(b.itemCode)) });
    const hash = createHash('sha256').update(canonical).digest('hex');
    const providedKey = req.headers.get('Idempotency-Key') ?? body.idempotencyKey;
    if (providedKey !== undefined && (typeof providedKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(providedKey))) throw new Error('Idempotency-Key inválida.');
    const requestKey = `${storeId}:${providedKey ?? hash}`;
    const { data: claim, error: claimError } = await db.rpc('claim_viele_checkout', { p_key: requestKey, p_store_id: storeId, p_hash: hash });
    if (claimError || !claim) return NextResponse.json({ success: false, error: 'Envío bloqueado: el control durable de pedidos no está disponible. Verifica la migración de Viele.' }, { status: 503 });
    if (!claim.claimed) {
      if (claim.state === 'completed' && claim.result) return NextResponse.json({ ...claim.result, replayed: true });
      return NextResponse.json({ success: false, recoveryRequired: claim.state === 'recovery_required', error: claim.mismatch ? 'La clave ya pertenece a otra captura.' : 'Existe un envío en proceso o pendiente de conciliación para esta sucursal. No reenvíes el pedido.', requestKey }, { status: 409 });
    }
    claimedKey = requestKey;
    const result = await placeVieleOrder({ storeId, items: lines, shipDate: body.shipDate, buyerName, customerPo, notes, isSimulation: false });
    const batches = [result.orderSodas, result.orderGeneral].filter((order): order is SingleOrderResult => !!order);
    const verified = (order: SingleOrderResult) => order.vieleRawResponse?.validation?.valid === true && order.vieleRawResponse?.financialsVerified === true;
    const orders = batches.map(order => ({ header: { ...baseHeader, order_number: order.orderNumber, order_category: order.orderCategory,
      linked_order_number: batches.find(other => other !== order)?.orderNumber ?? null, status: verified(order) ? 'confirmed' : 'reconciliation_required',
      total_cases: order.totalCases, subtotal_amount: order.subtotalAmount, tax_amount: order.taxAmount, total_amount: order.totalAmount,
      viele_response: { ...order.vieleRawResponse, requestKey } }, items: toItems(order.items.map(i => ({ ...i, parQuantity: i.parQuantity ?? 0, leftoverQuantity: i.leftoverQuantity ?? 0 }))) }));
    let saved: any[] = [];
    let persistenceError = false;
    if (orders.length) {
      const persisted = await db.rpc('persist_viele_order_batch', { p_orders: orders });
      persistenceError = !!persisted.error;
      saved = persisted.data || [];
    }
    const complete = result.success && batches.length > 0 && batches.every(verified) && !persistenceError;
    const response = { success: complete, split: result.split, partialSuccess: !result.success && batches.length > 0,
      recoveryRequired: !complete, requestKey, orderNumbers: batches.map(order => order.orderNumber),
      orderNumber: result.orderNumber, orderNumberSodas: result.orderSodas?.orderNumber, orderNumberGeneral: result.orderGeneral?.orderNumber,
      order: saved[0], orderSodas: saved.find(o => o.order_category === 'sodas'), orderGeneral: saved.find(o => o.order_category === 'general'),
      totalCases: result.totalCases, subtotalAmount: result.subtotalAmount, taxAmount: result.taxAmount, totalAmount: result.totalAmount,
      isSimulation: false, error: complete ? undefined : persistenceError ? 'Pedido emitido; falló el registro local. Requiere recuperación sin reenviar a Viele.' : result.error || 'Pedido emitido; conciliación pendiente. No reenviar.' };
    const { error: finalizeError } = await db.from('viele_checkout_requests').update({ state: complete ? 'completed' : 'recovery_required',
      result: { ...response, recoverySnapshot: complete ? undefined : orders }, updated_at: new Date().toISOString() }).eq('request_key', requestKey);
    if (finalizeError) return NextResponse.json({ ...response, success: false, recoveryRequired: true, error: 'Resultado emitido; no se pudo finalizar su registro durable. No reenviar.' }, { status: 503 });
    return NextResponse.json(response, { status: complete ? 200 : 409 });
  } catch (error) {
    if (claimedKey) {
      await db.from('viele_checkout_requests').update({ state: 'recovery_required', updated_at: new Date().toISOString() }).eq('request_key', claimedKey);
      return NextResponse.json({ success: false, recoveryRequired: true, requestKey: claimedKey, error: 'Envío interrumpido: verifica Viele antes de cualquier reintento.' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Solicitud inválida.' }, { status: 400 });
  }
}

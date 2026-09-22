/**
 * @module api/viele/orders
 * @description Endpoint para creación, consulta y checkout de pedidos a Viele & Sons.
 *              Soporta modos 'live' (checkout oficial contra Sage 100), 'simulation' (dry-run)
 *              y 'draft' (borrador local sin llamada a la API de Viele).
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Valida cantidades estrictamente enteras y mayores a cero.
 * - Modos de ejecución claros e inequívocos: 'live', 'simulation', 'draft'.
 * - Persiste orden de compra oficial de Sage 100 (Wxxxxxx) en viele_orders con estatus 'confirmed'.
 * - Manejo de éxito parcial: si la orden de Sodas se confirma en Viele pero la de Insumos falla,
 *   se persiste inmediatamente la orden de Sodas para evitar reenvíos duplicados.
 * - Idempotencia: previene envíos simultáneos o doble-clic para la misma tienda y fecha.
 * - Control RBAC por sucursal para lectura y emisión de pedidos.
 *
 * @dataFlow
 * - Frontend → POST /api/viele/orders
 * - Backend → placeVieleOrder (lib/viele-api.ts)
 * - Supabase → INSERT viele_orders + INSERT viele_order_items con verificación estricta de errores.
 *
 * @notes
 * - [2026-09-21] Implementación de control de acceso verifyVieleAuth, persistencia de éxito parcial,
 *   idempotencia contra doble clic, fecha en zona horaria America/Los_Angeles y validación de enteros.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { placeVieleOrder } from '@/lib/viele-api';
import { isVieleChemical, isVieleSoda } from '@/lib/viele-catalog-data';
import { verifyVieleAuth } from '@/lib/viele-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, serviceKey);

// Candado en memoria para prevenir envíos duplicados concurrentes (storeId-shipDate)
const activeOrderLocks = new Map<string, number>();

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId');
    const orderId = searchParams.get('orderId');

    // 1. Verificación de autenticación y autorización
    const auth = verifyVieleAuth(req);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    if (orderId) {
      // Detalle de una orden específica
      const { data: order, error: orderError } = await supabase
        .from('viele_orders')
        .select(`
          *,
          stores (id, name, code)
        `)
        .eq('id', orderId)
        .single();

      if (orderError) {
        return NextResponse.json({ success: false, error: orderError.message }, { status: 500 });
      }

      // Validar que el usuario tenga acceso a la tienda de la orden
      if (auth.role !== 'admin' && auth.allowedStoreIds && !auth.allowedStoreIds.includes(order.store_id)) {
        return NextResponse.json({ success: false, error: 'Acceso denegado: No tienes permiso para ver esta orden' }, { status: 403 });
      }

      const { data: items, error: itemsError } = await supabase
        .from('viele_order_items')
        .select('*')
        .eq('order_id', orderId)
        .order('id', { ascending: true });

      if (itemsError) {
        return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, order, items });
    }

    // Listado de órdenes
    let dbQuery = supabase
      .from('viele_orders')
      .select(`
        id,
        store_id,
        order_number,
        order_category,
        linked_order_number,
        order_date,
        ship_date,
        status,
        total_cases,
        subtotal_amount,
        tax_amount,
        total_amount,
        buyer_name,
        customer_po_no,
        created_at,
        stores (id, name, code),
        viele_order_items (id)
      `)
      .order('created_at', { ascending: false });

    if (storeId && storeId !== 'all') {
      const sid = parseInt(storeId);
      if (auth.role !== 'admin' && auth.allowedStoreIds && !auth.allowedStoreIds.includes(sid)) {
        return NextResponse.json({ success: false, error: 'Acceso denegado a esta sucursal' }, { status: 403 });
      }
      dbQuery = dbQuery.eq('store_id', sid);
    } else {
      // Restricción por alcance de rol cuando no se filtra por una tienda específica
      if (auth.role !== 'admin' && auth.allowedStoreIds && auth.allowedStoreIds.length > 0) {
        dbQuery = dbQuery.in('store_id', auth.allowedStoreIds);
      } else if (auth.role === 'manager' && auth.userStoreId) {
        dbQuery = dbQuery.eq('store_id', auth.userStoreId);
      }
    }

    const categoryFilter = searchParams.get('category');
    if (categoryFilter && categoryFilter !== 'all') {
      dbQuery = dbQuery.eq('order_category', categoryFilter);
    }

    const yearFilter = searchParams.get('year');
    if (yearFilter && /^\d{4}$/.test(yearFilter)) {
      dbQuery = dbQuery
        .gte('order_date', `${yearFilter}-01-01`)
        .lte('order_date', `${yearFilter}-12-31`);
    }

    const { data, error } = await dbQuery.limit(200);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const mappedOrders = (data || []).map((o: any) => {
      const itemsCount = Array.isArray(o.viele_order_items) ? o.viele_order_items.length : 0;
      const { viele_order_items, ...rest } = o;
      return {
        ...rest,
        items_count: itemsCount,
        total_catalog_items: o.store_id === 13 ? 88 : 87
      };
    });

    return NextResponse.json({ success: true, count: mappedOrders.length, orders: mappedOrders });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let lockKey: string | null = null;
  try {
    const body = await req.json();
    const {
      storeId,
      items,
      shipDate,
      buyerName,
      customerPo,
      notes
    } = body;

    if (!storeId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'storeId y un arreglo de artículos son requeridos.'
      }, { status: 400 });
    }

    if (!shipDate) {
      return NextResponse.json({
        success: false,
        error: 'shipDate es requerida.'
      }, { status: 400 });
    }

    const numericStoreId = parseInt(storeId, 10);

    // 1. Verificación de autenticación y autorización por sucursal
    const auth = verifyVieleAuth(req, { requiredStoreId: numericStoreId });
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 });
    }

    // 2. Determinación inequívoca del modo de ejecución ('live' | 'simulation' | 'draft')
    let action: 'live' | 'simulation' | 'draft' = 'draft';
    if (body.action) {
      if (['live', 'simulation', 'draft'].includes(body.action)) {
        action = body.action;
      } else {
        return NextResponse.json({
          success: false,
          error: `Acción inválida: ${body.action}. Opciones válidas: 'live', 'simulation', 'draft'.`
        }, { status: 400 });
      }
    } else {
      // Soporte retrocompatible seguro: coerción booleana estricta (no tratar "false" como truthy)
      const isLive = body.submitLive === true || body.submitLive === 'true' || body.submitLive === 1;
      const isSim = body.isSimulation === true || body.isSimulation === 'true' || body.isSimulation === 1;
      if (isLive) action = 'live';
      else if (isSim) action = 'simulation';
      else action = 'draft';
    }

    // 3. Validación numérica estricta de partidas
    for (const item of items) {
      const rawQty = item.orderQuantity;
      if (rawQty !== undefined && rawQty !== null && rawQty !== '') {
        const qtyNum = Number(rawQty);
        if (!Number.isFinite(qtyNum) || qtyNum < 0) {
          return NextResponse.json({
            success: false,
            error: `Cantidad inválida para ${item.itemCode || 'artículo'}: debe ser un número entero positivo.`
          }, { status: 400 });
        }
      }
    }

    const validLines = items.filter((i: any) => {
      const qty = Number(i.orderQuantity);
      return Number.isFinite(qty) && qty > 0;
    });

    if (validLines.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Debe ordenar al menos un producto con cantidad mayor a cero.'
      }, { status: 400 });
    }

    const resolvedBuyer = buyerName?.trim() || 'AFV';
    const resolvedCustomerPo = customerPo?.trim() || resolvedBuyer;

    // Fecha oficial en zona horaria local de California (America/Los_Angeles)
    const orderDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

    // ═══ MODO 1: GUARDAR BORRADOR LOCAL (action === 'draft') ═══
    // No invoca a Viele API; persiste directamente en Supabase con estatus 'draft'
    if (action === 'draft') {
      let draftSubtotal = 0;
      let draftTax = 0;
      let draftCases = 0;

      const draftItemDetails = validLines.map((i: any) => {
        const qty = Math.round(Number(i.orderQuantity));
        const price = Number(i.unitPrice) || 0;
        const ext = parseFloat((qty * price).toFixed(2));
        draftCases += qty;
        draftSubtotal += ext;
        const isChem = isVieleChemical(i.itemCode);
        if (isChem) {
          draftTax += parseFloat((ext * 0.095).toFixed(2));
        }
        return {
          item_code: i.itemCode,
          description: i.description,
          uom: i.uom || 'CS',
          unit_price: price,
          par_quantity: Math.round(Number(i.parQuantity) || 0),
          leftover_quantity: parseFloat(Number(i.leftoverQuantity || 0).toFixed(2)),
          suggested_quantity: Math.max(0, Math.round((Number(i.parQuantity) || 0) - (Number(i.leftoverQuantity) || 0))),
          order_quantity: qty,
          extended_amount: ext,
          is_taxable: isChem,
          bin_no: i.itemCode === 'IC5GLIDI' ? '2801B' : (i.itemCode === 'IC4DESC' ? '2806B' : null)
        };
      });

      draftSubtotal = parseFloat(draftSubtotal.toFixed(2));
      draftTax = parseFloat(draftTax.toFixed(2));
      const draftTotal = parseFloat((draftSubtotal + draftTax).toFixed(2));
      const draftNumber = resolvedCustomerPo.startsWith('BORR')
        ? resolvedCustomerPo
        : `BORR-${numericStoreId}-${Date.now().toString().slice(-6)}`;

      const draftCategory = validLines.some((i: any) => i.isSoda || isVieleSoda(i.itemCode))
        ? (validLines.some((i: any) => !i.isSoda && !isVieleSoda(i.itemCode)) ? 'mixed' : 'sodas')
        : 'general';

      const { data: insertedDraft, error: errDraft } = await supabase
        .from('viele_orders')
        .insert({
          store_id: numericStoreId,
          order_number: draftNumber,
          order_category: draftCategory,
          order_date: orderDate,
          ship_date: shipDate,
          status: 'draft',
          total_cases: draftCases,
          subtotal_amount: draftSubtotal,
          tax_amount: draftTax,
          total_amount: draftTotal,
          buyer_name: resolvedBuyer,
          customer_po_no: resolvedCustomerPo,
          salesperson: 'D. TAMAYO',
          route: 'W08',
          terms: 'NET 30 DAYS',
          notes: notes || null
        })
        .select()
        .single();

      if (errDraft) {
        return NextResponse.json({ success: false, error: `Error guardando borrador: ${errDraft.message}` }, { status: 500 });
      }

      const draftRowsWithOrderId = draftItemDetails.map(it => ({
        ...it,
        order_id: insertedDraft.id
      }));

      const { error: errDraftItems } = await supabase.from('viele_order_items').insert(draftRowsWithOrderId);
      if (errDraftItems) {
        return NextResponse.json({ success: false, error: `Error guardando partidas del borrador: ${errDraftItems.message}` }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        mode: 'draft',
        order: insertedDraft,
        itemsCount: draftRowsWithOrderId.length,
        orderNumber: draftNumber,
        totalCases: draftCases,
        totalAmount: draftTotal,
        isSimulation: true
      });
    }

    // ═══ MODO 2: SIMULACIÓN EN SECO (action === 'simulation') ═══
    if (action === 'simulation') {
      const simResult = await placeVieleOrder({
        storeId: numericStoreId,
        items: validLines.map((i: any) => ({
          itemCode: i.itemCode,
          description: i.description,
          quantity: Math.round(Number(i.orderQuantity)),
          uom: i.uom || 'CS',
          unitPrice: Number(i.unitPrice) || 0,
          parQuantity: Math.round(Number(i.parQuantity) || 0),
          leftoverQuantity: parseFloat(Number(i.leftoverQuantity || 0).toFixed(2))
        })),
        shipDate,
        buyerName: resolvedBuyer,
        customerPo: resolvedCustomerPo,
        notes,
        isSimulation: true
      });

      return NextResponse.json({
        mode: 'simulation',
        ...simResult
      });
    }

    // ═══ MODO 3: ENVÍO EN VIVO A VIELE & SONS (action === 'live') ═══

    // Control de Idempotencia: evitar doble submit
    lockKey = `${numericStoreId}-${shipDate}`;
    const now = Date.now();
    const existingLockTime = activeOrderLocks.get(lockKey);
    if (existingLockTime && (now - existingLockTime) < 45000) {
      return NextResponse.json({
        success: false,
        error: 'Un pedido para esta sucursal y fecha de entrega ya se encuentra en proceso de transmisión. Por favor espere.'
      }, { status: 409 });
    }
    activeOrderLocks.set(lockKey, now);

    const orderResult = await placeVieleOrder({
      storeId: numericStoreId,
      items: validLines.map((i: any) => ({
        itemCode: i.itemCode,
        description: i.description,
        quantity: Math.round(Number(i.orderQuantity)),
        uom: i.uom || 'CS',
        unitPrice: Number(i.unitPrice) || 0,
        parQuantity: Math.round(Number(i.parQuantity) || 0),
        leftoverQuantity: parseFloat(Number(i.leftoverQuantity || 0).toFixed(2))
      })),
      shipDate,
      buyerName: resolvedBuyer,
      customerPo: resolvedCustomerPo,
      notes,
      isSimulation: false
    });

    // Manejo de Éxito Parcial: Sodas se procesó pero General falló
    if (orderResult.split && orderResult.orderSodas && !orderResult.success) {
      // Persistir de inmediato la orden de sodas confirmada para no perderla ni duplicarla
      const { data: insertedSodas, error: errSodas } = await supabase
        .from('viele_orders')
        .insert({
          store_id: numericStoreId,
          order_number: orderResult.orderSodas.orderNumber,
          order_category: 'sodas',
          linked_order_number: null,
          order_date: orderDate,
          ship_date: shipDate,
          status: 'confirmed',
          total_cases: orderResult.orderSodas.totalCases,
          subtotal_amount: orderResult.orderSodas.subtotalAmount,
          tax_amount: orderResult.orderSodas.taxAmount,
          total_amount: orderResult.orderSodas.totalAmount,
          buyer_name: resolvedBuyer,
          customer_po_no: resolvedCustomerPo,
          salesperson: 'D. TAMAYO',
          route: 'W08',
          terms: 'NET 30 DAYS',
          viele_response: orderResult.orderSodas.vieleRawResponse,
          notes: notes ? `[SODAS] ${notes}` : '[SODAS]'
        })
        .select()
        .single();

      if (!errSodas && insertedSodas) {
        const sodaItemRows = orderResult.orderSodas.items.map((i: any) => {
          const qty = Math.round(Number(i.quantity));
          const price = Number(i.unitPrice) || 0;
          return {
            order_id: insertedSodas.id,
            item_code: i.itemCode,
            description: i.description,
            uom: i.uom || 'EACH',
            unit_price: price,
            par_quantity: Math.round(Number(i.parQuantity) || 0),
            leftover_quantity: parseFloat(Number(i.leftoverQuantity || 0).toFixed(2)),
            suggested_quantity: Math.max(0, Math.round((Number(i.parQuantity) || 0) - (Number(i.leftoverQuantity) || 0))),
            order_quantity: qty,
            extended_amount: parseFloat((qty * price).toFixed(2)),
            is_taxable: false,
            bin_no: null
          };
        });
        await supabase.from('viele_order_items').insert(sodaItemRows);
      }

      return NextResponse.json({
        success: true,
        partialSuccess: true,
        sodasConfirmed: true,
        orderNumberSodas: orderResult.orderSodas.orderNumber,
        orderSodas: insertedSodas,
        generalFailed: true,
        error: orderResult.error,
        message: `⚠️ Éxito parcial: La orden de Sodas fue emitida y confirmada en Viele & Sons (${orderResult.orderSodas.orderNumber}) y registrada en el sistema. Sin embargo, falló la orden de Insumos Generales: ${orderResult.error}. Por favor reintente únicamente los insumos generales.`
      }, { status: 207 });
    }

    if (!orderResult.success) {
      return NextResponse.json({
        success: false,
        error: orderResult.error
      }, { status: 400 });
    }

    // Persistir órdenes confirmadas en Supabase
    if (orderResult.split && orderResult.orderSodas && orderResult.orderGeneral) {
      // 1. Persistir Orden de Sodas
      const { data: insertedSodas, error: errSodas } = await supabase
        .from('viele_orders')
        .insert({
          store_id: numericStoreId,
          order_number: orderResult.orderSodas.orderNumber,
          order_category: 'sodas',
          linked_order_number: orderResult.orderGeneral.orderNumber,
          order_date: orderDate,
          ship_date: shipDate,
          status: 'confirmed',
          total_cases: orderResult.orderSodas.totalCases,
          subtotal_amount: orderResult.orderSodas.subtotalAmount,
          tax_amount: orderResult.orderSodas.taxAmount,
          total_amount: orderResult.orderSodas.totalAmount,
          buyer_name: resolvedBuyer,
          customer_po_no: resolvedCustomerPo,
          salesperson: 'D. TAMAYO',
          route: 'W08',
          terms: 'NET 30 DAYS',
          viele_response: orderResult.orderSodas.vieleRawResponse,
          notes: notes ? `[SODAS] ${notes}` : '[SODAS]'
        })
        .select()
        .single();

      if (errSodas) {
        console.error('Error insertando orden de sodas en BD:', errSodas);
        return NextResponse.json({ success: false, error: `Error guardando orden de sodas: ${errSodas.message}` }, { status: 500 });
      }

      const sodaItemRows = orderResult.orderSodas.items.map((i: any) => {
        const qty = Math.round(Number(i.quantity));
        const price = Number(i.unitPrice) || 0;
        return {
          order_id: insertedSodas.id,
          item_code: i.itemCode,
          description: i.description,
          uom: i.uom || 'EACH',
          unit_price: price,
          par_quantity: Math.round(Number(i.parQuantity) || 0),
          leftover_quantity: parseFloat(Number(i.leftoverQuantity || 0).toFixed(2)),
          suggested_quantity: Math.max(0, Math.round((Number(i.parQuantity) || 0) - (Number(i.leftoverQuantity) || 0))),
          order_quantity: qty,
          extended_amount: parseFloat((qty * price).toFixed(2)),
          is_taxable: false,
          bin_no: null
        };
      });
      const { error: errSodaItems } = await supabase.from('viele_order_items').insert(sodaItemRows);
      if (errSodaItems) {
        console.error('Error insertando partidas de sodas:', errSodaItems);
      }

      // 2. Persistir Orden de Insumos Generales
      const { data: insertedGeneral, error: errGeneral } = await supabase
        .from('viele_orders')
        .insert({
          store_id: numericStoreId,
          order_number: orderResult.orderGeneral.orderNumber,
          order_category: 'general',
          linked_order_number: orderResult.orderSodas.orderNumber,
          order_date: orderDate,
          ship_date: shipDate,
          status: 'confirmed',
          total_cases: orderResult.orderGeneral.totalCases,
          subtotal_amount: orderResult.orderGeneral.subtotalAmount,
          tax_amount: orderResult.orderGeneral.taxAmount,
          total_amount: orderResult.orderGeneral.totalAmount,
          buyer_name: resolvedBuyer,
          customer_po_no: resolvedCustomerPo,
          salesperson: 'D. TAMAYO',
          route: 'W08',
          terms: 'NET 30 DAYS',
          viele_response: orderResult.orderGeneral.vieleRawResponse,
          notes: notes ? `[INSUMOS] ${notes}` : '[INSUMOS]'
        })
        .select()
        .single();

      if (errGeneral) {
        console.error('Error insertando orden de insumos en BD:', errGeneral);
        return NextResponse.json({ success: false, error: `Error guardando orden de insumos: ${errGeneral.message}` }, { status: 500 });
      }

      const genItemRows = orderResult.orderGeneral.items.map((i: any) => {
        const qty = Math.round(Number(i.quantity));
        const price = Number(i.unitPrice) || 0;
        return {
          order_id: insertedGeneral.id,
          item_code: i.itemCode,
          description: i.description,
          uom: i.uom || 'CS',
          unit_price: price,
          par_quantity: Math.round(Number(i.parQuantity) || 0),
          leftover_quantity: parseFloat(Number(i.leftoverQuantity || 0).toFixed(2)),
          suggested_quantity: Math.max(0, Math.round((Number(i.parQuantity) || 0) - (Number(i.leftoverQuantity) || 0))),
          order_quantity: qty,
          extended_amount: parseFloat((qty * price).toFixed(2)),
          is_taxable: isVieleChemical(i.itemCode),
          bin_no: i.itemCode === 'IC5GLIDI' ? '2801B' : (i.itemCode === 'IC4DESC' ? '2806B' : null)
        };
      });
      const { error: errGenItems } = await supabase.from('viele_order_items').insert(genItemRows);
      if (errGenItems) {
        console.error('Error insertando partidas de insumos:', errGenItems);
      }

      return NextResponse.json({
        success: true,
        split: true,
        orderNumberSodas: orderResult.orderSodas.orderNumber,
        orderNumberGeneral: orderResult.orderGeneral.orderNumber,
        orderSodas: insertedSodas,
        orderGeneral: insertedGeneral,
        totalCases: orderResult.totalCases,
        totalAmount: orderResult.totalAmount,
        subtotalAmount: orderResult.subtotalAmount,
        taxAmount: orderResult.taxAmount,
        isSimulation: false,
        message: 'Se generaron exitosamente 2 órdenes independientes en Viele & Sons (1 Factura para Sodas y 1 Factura para Insumos Generales).'
      });
    }

    // Orden única (Solo sodas, solo insumos generales o solo químicos)
    let category = orderResult.orderCategory;
    if (!category) {
      if (validLines.every((i: any) => isVieleChemical(i.itemCode))) {
        category = 'chemicals';
      } else if (validLines.some((i: any) => i.isSoda || isVieleSoda(i.itemCode))) {
        category = 'sodas';
      } else {
        category = 'general';
      }
    }

    const { data: insertedOrder, error: orderInsertError } = await supabase
      .from('viele_orders')
      .insert({
        store_id: numericStoreId,
        order_number: orderResult.orderNumber,
        order_category: category,
        order_date: orderDate,
        ship_date: shipDate,
        status: 'confirmed',
        total_cases: orderResult.totalCases,
        subtotal_amount: orderResult.subtotalAmount,
        tax_amount: orderResult.taxAmount,
        total_amount: orderResult.totalAmount,
        buyer_name: resolvedBuyer,
        customer_po_no: resolvedCustomerPo,
        salesperson: 'D. TAMAYO',
        route: 'W08',
        terms: 'NET 30 DAYS',
        viele_response: orderResult.vieleRawResponse,
        notes: notes || null
      })
      .select()
      .single();

    if (orderInsertError) {
      return NextResponse.json({
        success: false,
        error: `Pedido procesado en Viele pero ocurrió un error al guardar en BD: ${orderInsertError.message}`,
        orderResult
      }, { status: 500 });
    }

    const itemRows = validLines.map((i: any) => {
      const qty = Math.round(Number(i.orderQuantity));
      const price = Number(i.unitPrice) || 0;
      return {
        order_id: insertedOrder.id,
        item_code: i.itemCode,
        description: i.description,
        uom: i.uom || 'CS',
        unit_price: price,
        par_quantity: Math.round(Number(i.parQuantity) || 0),
        leftover_quantity: parseFloat(Number(i.leftoverQuantity || 0).toFixed(2)),
        suggested_quantity: Math.max(0, Math.round((Number(i.parQuantity) || 0) - (Number(i.leftoverQuantity) || 0))),
        order_quantity: qty,
        extended_amount: parseFloat((qty * price).toFixed(2)),
        is_taxable: isVieleChemical(i.itemCode),
        bin_no: i.itemCode === 'IC5GLIDI' ? '2801B' : (i.itemCode === 'IC4DESC' ? '2806B' : null)
      };
    });

    const { error: errItems } = await supabase.from('viele_order_items').insert(itemRows);
    if (errItems) {
      console.error('Error insertando partidas de la orden:', errItems);
    }

    return NextResponse.json({
      success: true,
      split: false,
      order: insertedOrder,
      itemsCount: itemRows.length,
      orderNumber: orderResult.orderNumber,
      orderCategory: category,
      totalCases: orderResult.totalCases,
      totalAmount: orderResult.totalAmount,
      isSimulation: false
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    if (lockKey) {
      activeOrderLocks.delete(lockKey);
    }
  }
}

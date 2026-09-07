/**
 * @module api/viele/orders
 * @description Endpoint para creación, consulta y checkout de pedidos a Viele & Sons.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan
 * - Valida cantidades mayores a cero.
 * - Soporta modo borrador (draft) y modo live checkout (contra API de Viele).
 * - Persiste orden de compra oficial de Sage 100 (Wxxxxxx) en viele_orders.
 *
 * @dataFlow
 * - Frontend → POST /api/viele/orders
 * - Backend → placeVieleOrder (lib/viele-api.ts)
 * - Supabase → INSERT viele_orders + INSERT viele_order_items
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { placeVieleOrder } from '@/lib/viele-api';
import { isVieleChemical } from '@/lib/viele-catalog-data';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, serviceKey);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId');
    const orderId = searchParams.get('orderId');

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
        stores (id, name, code)
      `)
      .order('created_at', { ascending: false });

    if (storeId && storeId !== 'all') {
      dbQuery = dbQuery.eq('store_id', parseInt(storeId));
    }

    const categoryFilter = searchParams.get('category');
    if (categoryFilter && categoryFilter !== 'all') {
      dbQuery = dbQuery.eq('order_category', categoryFilter);
    }

    const { data, error } = await dbQuery.limit(50);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, count: data?.length || 0, orders: data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      storeId,
      items,
      shipDate,
      buyerName,
      customerPo,
      notes,
      submitLive,
      isSimulation
    } = body;

    if (!storeId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'storeId and an array of items are required.'
      }, { status: 400 });
    }

    if (!shipDate) {
      return NextResponse.json({
        success: false,
        error: 'shipDate is required.'
      }, { status: 400 });
    }

    const resolvedBuyer = buyerName?.trim() || 'AFV';
    const resolvedCustomerPo = customerPo?.trim() || resolvedBuyer;

    // Filtrar items con cantidad pedida > 0
    const validLines = items.filter((i: any) => Number(i.orderQuantity) > 0);
    if (validLines.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Debe ordenar al menos un producto con cantidad mayor a cero.'
      }, { status: 400 });
    }

    // Ejecutar pedido o simulación
    const orderResult = await placeVieleOrder({
      storeId: parseInt(storeId),
      items: validLines.map((i: any) => ({
        itemCode: i.itemCode,
        description: i.description,
        quantity: Number(i.orderQuantity),
        uom: i.uom || 'CS',
        unitPrice: Number(i.unitPrice) || 0,
        parQuantity: Number(i.parQuantity) || 0,
        leftoverQuantity: Number(i.leftoverQuantity) || 0
      })),
      shipDate,
      buyerName: resolvedBuyer,
      customerPo: resolvedCustomerPo,
      notes,
      isSimulation: submitLive ? false : (isSimulation ?? true)
    });

    if (!orderResult.success) {
      return NextResponse.json({
        success: false,
        error: orderResult.error
      }, { status: 400 });
    }

    // Persistir en Supabase
    const orderStatus = submitLive ? 'confirmed' : 'draft';
    const orderDate = new Date().toISOString().split('T')[0];

    if (orderResult.split && orderResult.orderSodas && orderResult.orderGeneral) {
      // 1. Persistir Orden de Sodas
      const { data: insertedSodas, error: errSodas } = await supabase
        .from('viele_orders')
        .insert({
          store_id: parseInt(storeId),
          order_number: orderResult.orderSodas.orderNumber,
          order_category: 'sodas',
          linked_order_number: orderResult.orderGeneral.orderNumber,
          order_date: orderDate,
          ship_date: shipDate,
          status: orderStatus,
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
      } else {
        const sodaItemRows = orderResult.orderSodas.items.map((i: any) => {
          const qty = Number(i.quantity);
          const price = Number(i.unitPrice) || 0;
          return {
            order_id: insertedSodas.id,
            item_code: i.itemCode,
            description: i.description,
            uom: i.uom || 'EACH',
            unit_price: price,
            par_quantity: Number(i.parQuantity) || 0,
            leftover_quantity: Number(i.leftoverQuantity) || 0,
            suggested_quantity: Math.max(0, (Number(i.parQuantity) || 0) - (Number(i.leftoverQuantity) || 0)),
            order_quantity: qty,
            extended_amount: parseFloat((qty * price).toFixed(2)),
            is_taxable: false,
            bin_no: null
          };
        });
        await supabase.from('viele_order_items').insert(sodaItemRows);
      }

      // 2. Persistir Orden de Insumos Generales
      const { data: insertedGeneral, error: errGeneral } = await supabase
        .from('viele_orders')
        .insert({
          store_id: parseInt(storeId),
          order_number: orderResult.orderGeneral.orderNumber,
          order_category: 'general',
          linked_order_number: orderResult.orderSodas.orderNumber,
          order_date: orderDate,
          ship_date: shipDate,
          status: orderStatus,
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
      } else {
        const genItemRows = orderResult.orderGeneral.items.map((i: any) => {
          const qty = Number(i.quantity);
          const price = Number(i.unitPrice) || 0;
          return {
            order_id: insertedGeneral.id,
            item_code: i.itemCode,
            description: i.description,
            uom: i.uom || 'CS',
            unit_price: price,
            par_quantity: Number(i.parQuantity) || 0,
            leftover_quantity: Number(i.leftoverQuantity) || 0,
            suggested_quantity: Math.max(0, (Number(i.parQuantity) || 0) - (Number(i.leftoverQuantity) || 0)),
            order_quantity: qty,
            extended_amount: parseFloat((qty * price).toFixed(2)),
            is_taxable: isVieleChemical(i.itemCode),
            bin_no: i.itemCode === 'IC5GLIDI' ? '2801B' : (i.itemCode === 'IC4DESC' ? '2806B' : null)
          };
        });
        await supabase.from('viele_order_items').insert(genItemRows);
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
        isSimulation: orderResult.isSimulation,
        message: 'Se generaron exitosamente 2 órdenes independientes en Viele & Sons (1 Factura para Sodas y 1 Factura para Insumos Generales).'
      });
    }

    // Orden única (Solo sodas, solo insumos generales o solo químicos)
    let category = orderResult.orderCategory;
    if (!category) {
      if (validLines.every((i: any) => isVieleChemical(i.itemCode))) {
        category = 'chemicals';
      } else if (validLines.some((i: any) => i.isSoda)) {
        category = 'sodas';
      } else {
        category = 'general';
      }
    }

    const { data: insertedOrder, error: orderInsertError } = await supabase
      .from('viele_orders')
      .insert({
        store_id: parseInt(storeId),
        order_number: orderResult.orderNumber,
        order_category: category,
        order_date: orderDate,
        ship_date: shipDate,
        status: orderStatus,
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
        error: `Pedido procesado pero ocurrió un error al guardar en BD: ${orderInsertError.message}`,
        orderResult
      }, { status: 500 });
    }

    const itemRows = validLines.map((i: any) => {
      const qty = Number(i.orderQuantity);
      const price = Number(i.unitPrice) || 0;
      return {
        order_id: insertedOrder.id,
        item_code: i.itemCode,
        description: i.description,
        uom: i.uom || 'CS',
        unit_price: price,
        par_quantity: Number(i.parQuantity) || 0,
        leftover_quantity: Number(i.leftoverQuantity) || 0,
        suggested_quantity: Math.max(0, (Number(i.parQuantity) || 0) - (Number(i.leftoverQuantity) || 0)),
        order_quantity: qty,
        extended_amount: parseFloat((qty * price).toFixed(2)),
        is_taxable: isVieleChemical(i.itemCode),
        bin_no: i.itemCode === 'IC5GLIDI' ? '2801B' : (i.itemCode === 'IC4DESC' ? '2806B' : null)
      };
    });

    await supabase.from('viele_order_items').insert(itemRows);

    return NextResponse.json({
      success: true,
      split: false,
      order: insertedOrder,
      itemsCount: itemRows.length,
      orderNumber: orderResult.orderNumber,
      orderCategory: category,
      totalCases: orderResult.totalCases,
      totalAmount: orderResult.totalAmount,
      isSimulation: orderResult.isSimulation
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

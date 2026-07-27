'use server';

/**
 * @module uniformsActions
 * @description Server actions para la gestión de inventario y venta de uniformes.
 * @businessRules 
 * - stores.id es un valor numérico (int), no UUID.
 * - Los supervisores/admins ven todas las tiendas; los gerentes solo las asignadas.
 * - Un empleado nuevo recibe: 6 playeras, 1 gorra, 1 chamarra.
 * - Las transacciones de daño/intercambio deducen inventario pero no tienen costo ($0).
 * - Las ventas parciales se permiten si no hay suficiente stock.
 * @dataFlow Cliente -> Server Actions -> Supabase Admin Client -> Base de Datos
 * @notes No se usan mocks, todo interactúa con la base de datos real.
 */

import { getSupabaseAdminClient } from '@/lib/supabase';

export async function fetchStoresForUser(userRole: string, userStoreIds: string[]): Promise<{id: number, name: string}[]> {
  const supabase = await getSupabaseAdminClient();
  if (userRole === 'admin' || userRole === 'supervisor') {
    const { data, error } = await supabase
      .from('stores')
      .select('id, name')
      .eq('is_active', true);
    if (error) throw new Error(error.message);
    return data || [];
  } else {
    // Convertir IDs de string a numéricos si es necesario, pero vienen como strings en la prop
    const numericStoreIds = userStoreIds.map((id: string) => parseInt(id, 10));
    const { data, error } = await supabase
      .from('stores')
      .select('id, name')
      .in('id', numericStoreIds)
      .eq('is_active', true);
    if (error) throw new Error(error.message);
    return data || [];
  }
}

export async function fetchUniformsPricing(): Promise<any[]> {
  const supabase = await getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('uniforms_pricing')
    .select('*')
    .order('item_category');
  if (error) throw new Error(error.message);
  return data || [];
}

export async function updateUniformPricing(
  id: string, 
  updates: { sale_price?: number, provider_name?: string, provider_cost?: number, notes?: string }, 
  userEmail: string
): Promise<void> {
  const supabase = await getSupabaseAdminClient();
  const { error } = await supabase
    .from('uniforms_pricing')
    .update({
      ...updates,
      updated_by: userEmail,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function fetchUniformsStock(storeId: number): Promise<any[]> {
  const supabase = await getSupabaseAdminClient();
  const { data: stock, error: sErr } = await supabase
    .from('uniforms_inventory_stock')
    .select('*')
    .eq('store_id', storeId);
  if (sErr) throw new Error(sErr.message);

  const { data: pricing, error: pErr } = await supabase
    .from('uniforms_pricing')
    .select('*');
  if (pErr) throw new Error(pErr.message);

  const pricingMap = new Map((pricing || []).map((p: any) => [p.item_category, p]));

  return (stock || []).map((item: any) => {
    const p = pricingMap.get(item.item_category);
    return {
      ...item,
      display_name_es: p?.display_name_es || item.item_category,
      display_name_en: p?.display_name_en || item.item_category,
      sale_price: p?.sale_price || 0
    };
  });
}

export async function saveInitialCount(
  storeId: number, 
  counts: Array<{item_category: string, size: string, quantity: number}>, 
  userEmail: string
): Promise<{success: boolean}> {
  const supabase = await getSupabaseAdminClient();
  const businessDate = new Date().toISOString().split('T')[0];
  
  for (const count of counts) {
    const { data: existingStock } = await supabase
      .from('uniforms_inventory_stock')
      .select('quantity_on_hand')
      .eq('store_id', storeId)
      .eq('item_category', count.item_category)
      .eq('size', count.size)
      .single();

    const prevQty = existingStock ? existingStock.quantity_on_hand : 0;

    await supabase
      .from('uniforms_inventory_stock')
      .upsert({
        store_id: storeId,
        item_category: count.item_category,
        size: count.size,
        quantity_on_hand: count.quantity,
        updated_at: new Date().toISOString()
      }, { onConflict: 'store_id, item_category, size' });

    await supabase
      .from('uniforms_transactions')
      .insert({
        store_id: storeId,
        item_category: count.item_category,
        size: count.size,
        transaction_type: 'initial_count',
        quantity: count.quantity,
        previous_stock: prevQty,
        new_stock: count.quantity,
        unit_price: 0,
        total_amount: 0,
        business_date: businessDate,
        created_by: userEmail,
        created_at: new Date().toISOString()
      });
  }
  return { success: true };
}

export async function resetInitialCount(storeId: number, userEmail: string): Promise<{success: boolean}> {
  const supabase = await getSupabaseAdminClient();
  const businessDate = new Date().toISOString().split('T')[0];

  const { error: delErr } = await supabase
    .from('uniforms_inventory_stock')
    .delete()
    .eq('store_id', storeId);

  if (delErr) throw new Error(delErr.message);

  await supabase
    .from('uniforms_transactions')
    .insert({
      store_id: storeId,
      item_category: 'shirt_red',
      size: 'ONE_SIZE',
      transaction_type: 'initial_count_reset',
      quantity: 0,
      previous_stock: 0,
      new_stock: 0,
      unit_price: 0,
      total_amount: 0,
      reason: 'Reset initial count requested by user',
      business_date: businessDate,
      created_by: userEmail,
      created_at: new Date().toISOString()
    });

  return { success: true };
}

export async function saveManualAudit(
  storeId: number, 
  adjustments: Array<{item_category: string, size: string, newQty: number, reason: string}>, 
  userEmail: string
): Promise<{success: boolean}> {
  const supabase = await getSupabaseAdminClient();
  const businessDate = new Date().toISOString().split('T')[0];

  for (const adj of adjustments) {
    const { data: existingStock } = await supabase
      .from('uniforms_inventory_stock')
      .select('quantity_on_hand')
      .eq('store_id', storeId)
      .eq('item_category', adj.item_category)
      .eq('size', adj.size)
      .single();

    const prevQty = existingStock ? existingStock.quantity_on_hand : 0;
    const qtyDiff = adj.newQty - prevQty;

    await supabase
      .from('uniforms_inventory_stock')
      .upsert({
        store_id: storeId,
        item_category: adj.item_category,
        size: adj.size,
        quantity_on_hand: adj.newQty,
        updated_at: new Date().toISOString()
      }, { onConflict: 'store_id, item_category, size' });

    await supabase
      .from('uniforms_transactions')
      .insert({
        store_id: storeId,
        item_category: adj.item_category,
        size: adj.size,
        transaction_type: 'manual_audit',
        quantity: qtyDiff,
        previous_stock: prevQty,
        new_stock: adj.newQty,
        unit_price: 0,
        total_amount: 0,
        reason: adj.reason,
        business_date: businessDate,
        created_by: userEmail,
        created_at: new Date().toISOString()
      });
  }
  return { success: true };
}

export async function recordUniformSale(payload: { 
  storeId: number, 
  item_category: string, 
  size: string, 
  quantity: number, 
  employeeToastGuid?: string, 
  employeeName: string, 
  businessDate?: string, 
  userEmail: string 
}): Promise<{success: boolean, processedQty: number, warning?: string}> {
  const supabase = await getSupabaseAdminClient();
  const bDate = payload.businessDate || new Date().toISOString().split('T')[0];

  const { data: pricing } = await supabase
    .from('uniforms_pricing')
    .select('sale_price, is_free_for_roles')
    .eq('item_category', payload.item_category)
    .single();

  if (!pricing) throw new Error('Pricing not found');
  
  const unitPrice = pricing.sale_price || 0;

  const { data: stock } = await supabase
    .from('uniforms_inventory_stock')
    .select('quantity_on_hand')
    .eq('store_id', payload.storeId)
    .eq('item_category', payload.item_category)
    .eq('size', payload.size)
    .single();

  const prevQty = stock ? stock.quantity_on_hand : 0;
  if (prevQty <= 0) {
    return { success: false, processedQty: 0, warning: 'No stock available' };
  }

  let processedQty = payload.quantity;
  let warning = undefined;
  if (prevQty < payload.quantity) {
    processedQty = prevQty;
    warning = 'Partial delivery due to insufficient stock';
  }

  const newQty = prevQty - processedQty;
  const totalAmount = unitPrice * processedQty;

  await supabase
    .from('uniforms_inventory_stock')
    .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
    .eq('store_id', payload.storeId)
    .eq('item_category', payload.item_category)
    .eq('size', payload.size);

  await supabase
    .from('uniforms_transactions')
    .insert({
      store_id: payload.storeId,
      item_category: payload.item_category,
      size: payload.size,
      transaction_type: 'employee_sale',
      quantity: -processedQty,
      previous_stock: prevQty,
      new_stock: newQty,
      unit_price: unitPrice,
      total_amount: totalAmount,
      employee_toast_guid: payload.employeeToastGuid,
      employee_name: payload.employeeName,
      business_date: bDate,
      created_by: payload.userEmail,
      created_at: new Date().toISOString()
    });

  return { success: true, processedQty, warning };
}

export async function recordNewHirePackage(payload: { 
  storeId: number, 
  employeeName: string, 
  employeeToastGuid?: string, 
  sizes: { shirt: string, cap: string, jacket: string }, 
  businessDate?: string, 
  userEmail: string 
}): Promise<{results: Array<{item: string, requested: number, delivered: number, warning?: string}>}> {
  const supabase = await getSupabaseAdminClient();
  const bDate = payload.businessDate || new Date().toISOString().split('T')[0];
  const packageItems = [
    { item: 'shirt_red', size: payload.sizes.shirt, requested: 6 },
    { item: 'cap_red', size: payload.sizes.cap, requested: 1 },
    { item: 'jacket_red', size: payload.sizes.jacket, requested: 1 }
  ];

  const results: Array<{item: string, requested: number, delivered: number, warning?: string}> = [];

  for (const packItem of packageItems) {
    const { data: stock } = await supabase
      .from('uniforms_inventory_stock')
      .select('quantity_on_hand')
      .eq('store_id', payload.storeId)
      .eq('item_category', packItem.item)
      .eq('size', packItem.size)
      .single();
    
    const prevQty = stock ? stock.quantity_on_hand : 0;
    let delivered = packItem.requested;
    let warning = undefined;
    
    if (prevQty <= 0) {
      delivered = 0;
      warning = 'No stock available';
    } else if (prevQty < packItem.requested) {
      delivered = prevQty;
      warning = 'Partial delivery due to insufficient stock';
    }

    if (delivered > 0) {
      const newQty = prevQty - delivered;
      
      await supabase
        .from('uniforms_inventory_stock')
        .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
        .eq('store_id', payload.storeId)
        .eq('item_category', packItem.item)
        .eq('size', packItem.size);

      await supabase
        .from('uniforms_transactions')
        .insert({
          store_id: payload.storeId,
          item_category: packItem.item,
          size: packItem.size,
          transaction_type: 'new_hire_package',
          quantity: -delivered,
          previous_stock: prevQty,
          new_stock: newQty,
          unit_price: 0,
          total_amount: 0,
          employee_toast_guid: payload.employeeToastGuid,
          employee_name: payload.employeeName,
          business_date: bDate,
          created_by: payload.userEmail,
          created_at: new Date().toISOString()
        });
    }

    results.push({ item: packItem.item, requested: packItem.requested, delivered, warning });
  }

  return { results };
}

export async function recordDamageExchange(payload: { 
  storeId: number, 
  item_category: string, 
  size: string, 
  employeeName: string, 
  employeeToastGuid?: string,
  reason: string, 
  businessDate?: string, 
  userEmail: string 
}): Promise<{success: boolean, warning?: string}> {
  const supabase = await getSupabaseAdminClient();
  const bDate = payload.businessDate || new Date().toISOString().split('T')[0];

  const { data: stock } = await supabase
    .from('uniforms_inventory_stock')
    .select('quantity_on_hand')
    .eq('store_id', payload.storeId)
    .eq('item_category', payload.item_category)
    .eq('size', payload.size)
    .single();

  const prevQty = stock ? stock.quantity_on_hand : 0;
  if (prevQty <= 0) {
    return { success: false, warning: 'No stock available' };
  }

  const newQty = prevQty - 1;

  await supabase
    .from('uniforms_inventory_stock')
    .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
    .eq('store_id', payload.storeId)
    .eq('item_category', payload.item_category)
    .eq('size', payload.size);

  await supabase
    .from('uniforms_transactions')
    .insert({
      store_id: payload.storeId,
      item_category: payload.item_category,
      size: payload.size,
      transaction_type: 'damage_exchange',
      quantity: -1,
      previous_stock: prevQty,
      new_stock: newQty,
      unit_price: 0,
      total_amount: 0,
      employee_toast_guid: payload.employeeToastGuid,
      employee_name: payload.employeeName,
      reason: payload.reason,
      business_date: bDate,
      created_by: payload.userEmail,
      created_at: new Date().toISOString()
    });

  return { success: true };
}

export async function confirmOrderReception(payload: { 
  storeId: number, 
  orderId: string, 
  items: Array<{item_category: string, size: string, receivedQty: number}>, 
  notes?: string, 
  userEmail: string 
}): Promise<{success: boolean}> {
  const supabase = await getSupabaseAdminClient();
  const businessDate = new Date().toISOString().split('T')[0];

  for (const item of payload.items) {
    const { data: stock } = await supabase
      .from('uniforms_inventory_stock')
      .select('quantity_on_hand')
      .eq('store_id', payload.storeId)
      .eq('item_category', item.item_category)
      .eq('size', item.size)
      .single();

    const prevQty = stock ? stock.quantity_on_hand : 0;
    const newQty = prevQty + item.receivedQty;

    await supabase
      .from('uniforms_inventory_stock')
      .upsert({
        store_id: payload.storeId,
        item_category: item.item_category,
        size: item.size,
        quantity_on_hand: newQty,
        updated_at: new Date().toISOString()
      }, { onConflict: 'store_id, item_category, size' });

    await supabase
      .from('uniforms_transactions')
      .insert({
        store_id: payload.storeId,
        item_category: item.item_category,
        size: item.size,
        transaction_type: 'reception',
        quantity: item.receivedQty,
        previous_stock: prevQty,
        new_stock: newQty,
        unit_price: 0,
        total_amount: 0,
        reference_order_id: (payload.orderId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.orderId)) ? payload.orderId : null,
        reason: payload.notes,
        business_date: businessDate,
        created_by: payload.userEmail,
        created_at: new Date().toISOString()
      });
  }

  return { success: true };
}

export async function fetchTransactionHistory(
  storeId: number, 
  filters?: { startDate?: string, endDate?: string, type?: string }
): Promise<any[]> {
  const supabase = await getSupabaseAdminClient();
  let query = supabase
    .from('uniforms_transactions')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });

  if (filters?.startDate) {
    query = query.gte('business_date', filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte('business_date', filters.endDate);
  }
  if (filters?.type) {
    query = query.eq('transaction_type', filters.type);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchEmployeeKardex(employeeToastGuid: string): Promise<any[]> {
  const supabase = await getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('uniforms_transactions')
    .select('*')
    .eq('employee_toast_guid', employeeToastGuid)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchExecutiveDashboard(): Promise<{
  stores: Array<{id: number, name: string, totalItems: number, totalValue: number, hasInitialCount: boolean, lastAuditDate: string | null}>, 
  globalMetrics: {totalStock: number, totalSalesAmount: number, damageExchanges: number, pendingReceptions: number}
}> {
  const supabase = await getSupabaseAdminClient();
  
  const { data: stores } = await supabase.from('stores').select('id, name').eq('is_active', true);
  const { data: stockData } = await supabase.from('uniforms_inventory_stock').select('*');
  const { data: pricingData } = await supabase.from('uniforms_pricing').select('*');
  const { data: txData } = await supabase.from('uniforms_transactions').select('*');

  const pricingMap = new Map((pricingData || []).map((p: any) => [p.item_category, p]));

  let globalTotalStock = 0;
  let globalTotalSalesAmount = 0;
  let globalDamageExchanges = 0;

  const storesData = (stores || []).map((store: any) => {
    const storeStock = (stockData || []).filter((s: any) => s.store_id === store.id);
    const storeTx = (txData || []).filter((tx: any) => tx.store_id === store.id);

    const totalItems = storeStock.reduce((sum: number, item: any) => sum + (item.quantity_on_hand || 0), 0);
    const totalValue = storeStock.reduce((sum: number, item: any) => {
      const p = pricingMap.get(item.item_category);
      return sum + ((item.quantity_on_hand || 0) * (p?.sale_price || 0));
    }, 0);
    
    const hasInitialCount = storeTx.some((tx: any) => tx.transaction_type === 'initial_count');
    const manualAudits = storeTx
      .filter((tx: any) => tx.transaction_type === 'manual_audit')
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const lastAuditDate = manualAudits.length > 0 ? manualAudits[0].created_at : null;

    globalTotalStock += totalItems;
    globalTotalSalesAmount += storeTx
      .filter((tx: any) => tx.transaction_type === 'employee_sale')
      .reduce((sum: number, tx: any) => sum + (tx.total_amount || 0), 0);
    globalDamageExchanges += storeTx.filter((tx: any) => tx.transaction_type === 'damage_exchange').length;

    return {
      id: store.id,
      name: store.name,
      totalItems,
      totalValue,
      hasInitialCount,
      lastAuditDate
    };
  });

  return {
    stores: storesData,
    globalMetrics: {
      totalStock: globalTotalStock,
      totalSalesAmount: globalTotalSalesAmount,
      damageExchanges: globalDamageExchanges,
      pendingReceptions: 0
    }
  };
}

export async function fetchDailySalesTotal(storeId: number, businessDate: string): Promise<number> {
  const supabase = await getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('uniforms_transactions')
    .select('total_amount')
    .eq('store_id', storeId)
    .eq('business_date', businessDate)
    .eq('transaction_type', 'employee_sale');
    
  if (error) throw new Error(error.message);
  
  return (data || []).reduce((sum: number, tx: any) => sum + (tx.total_amount || 0), 0);
}

function parseUniformCategoryAndSize(itemName: string): { category: string, size: string } {
  const lower = itemName.toLowerCase().trim();
  
  let category = 'shirt_red';
  if (lower.includes('assistant') || lower.includes('asistente')) {
    category = 'shirt_assistant';
  } else if (lower.includes('shift leader') || lower.includes('lider') || lower.includes('líder')) {
    category = 'shirt_shift_leader';
  } else if (lower.includes('store manager') || lower.includes('camisa store manager') || lower.includes('manager')) {
    category = 'shirt_manager';
  } else if (lower.includes('team member') || lower.includes('team members') || lower.includes('red shirt') || lower.includes('playera roja')) {
    category = 'shirt_red';
  } else if (lower.includes('gorra negra') || (lower.includes('cap') && lower.includes('black'))) {
    category = 'cap_black';
  } else if (lower.includes('gorra') || lower.includes('cap')) {
    category = 'cap_red';
  } else if (lower.includes('chamarra negra') || (lower.includes('jacket') && lower.includes('black'))) {
    category = 'jacket_black';
  } else if (lower.includes('chamarra') || lower.includes('jacket')) {
    category = 'jacket_red';
  }

  let size = 'M';
  if (category === 'cap_red' || category === 'cap_black') {
    size = 'ONE_SIZE';
  } else if (lower.includes('xxx-large') || lower.includes('3xl') || lower.includes('xxx-l')) {
    size = '3XL';
  } else if (lower.includes('xx-large') || lower.includes('2xl') || lower.includes('xx-l')) {
    size = '2XL';
  } else if (lower.includes('x-large') || lower.includes('xlarge') || lower.includes(' x-l') || lower.endsWith(' xl')) {
    size = 'XL';
  } else if (lower.includes('x-small') || lower.includes('xsmall') || lower.includes(' xs')) {
    size = 'S';
  } else if (lower.includes('large') || lower.endsWith(' l') || lower.includes(' l ')) {
    size = 'L';
  } else if (lower.includes('medium') || lower.endsWith(' m') || lower.includes(' m ')) {
    size = 'M';
  } else if (lower.includes('small') || lower.endsWith(' s') || lower.includes(' s ')) {
    size = 'S';
  }

  return { category, size };
}

export async function fetchQBEstimateForReception(storeId: number, searchEstimate: string): Promise<{
  found: boolean,
  orderNumber?: string,
  orderDate?: string,
  items: Array<{
    id: string,
    category: string,
    size: string,
    orderedQty: number,
    receivedQty: number,
    isMissing: boolean,
    notes: string
  }>,
  message?: string
}> {
  const supabase = await getSupabaseAdminClient();
  const trimmed = searchEstimate.trim();

  if (!trimmed) {
    return { found: false, items: [], message: 'Ingresa un número de estimate u orden' };
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);

  // Strictly filter by storeId AND order_type = 'uniforms'
  let orderQuery = supabase
    .from('inventory_orders')
    .select('*, inventory_order_lines(*)')
    .eq('store_id', storeId)
    .eq('order_type', 'uniforms');

  if (isUuid) {
    orderQuery = orderQuery.eq('id', trimmed);
  } else {
    orderQuery = orderQuery.or(`qb_estimate_number.ilike.%${trimmed}%,qb_estimate_id.ilike.%${trimmed}%`);
  }

  const { data: orders } = await orderQuery.limit(1);

  if (!orders || orders.length === 0) {
    return { 
      found: false, 
      items: [], 
      message: `No se encontró una orden de uniformes registrada como "${trimmed}" para la tienda seleccionada.` 
    };
  }

  const order = orders[0];
  const lines = order.inventory_order_lines || [];

  const itemIds = lines.map((l: any) => l.inventory_item_id).filter(Boolean);
  const { data: invItems } = await supabase
    .from('inventory_items')
    .select('id, name')
    .in('id', itemIds.length > 0 ? itemIds : ['00000000-0000-0000-0000-000000000000']);

  const invItemMap = new Map((invItems || []).map((i: any) => [i.id, i.name]));

  const mappedItems = lines.map((l: any, idx: number) => {
    const itemName = invItemMap.get(l.inventory_item_id) || `Item #${idx + 1}`;
    const qty = l.final_qty || l.calculated_qty || 1;
    
    const parsed = parseUniformCategoryAndSize(itemName);

    return {
      id: String(l.id || idx + 1),
      category: parsed.category as any,
      size: parsed.size as any,
      orderedQty: qty,
      receivedQty: qty,
      isMissing: false,
      notes: ''
    };
  });

  return {
    found: true,
    orderNumber: order.qb_estimate_number || order.qb_estimate_id || order.id,
    orderDate: order.created_at,
    items: mappedItems
  };
}

export async function fetchRecentStoreEstimates(storeId: number): Promise<Array<{
  id: string,
  qb_estimate_number: string,
  qb_estimate_id: string,
  created_at: string,
  status: string
}>> {
  const supabase = await getSupabaseAdminClient();
  const { data: orders } = await supabase
    .from('inventory_orders')
    .select('id, qb_estimate_number, qb_estimate_id, created_at, status')
    .eq('store_id', storeId)
    .eq('order_type', 'uniforms')
    .order('created_at', { ascending: false })
    .limit(10);

  return (orders || []).map((o: any) => ({
    id: o.id,
    qb_estimate_number: o.qb_estimate_number || o.qb_estimate_id || o.id.substring(0, 8),
    qb_estimate_id: o.qb_estimate_id || '',
    created_at: o.created_at,
    status: o.status || 'pending'
  }));
}

export async function fetchEmployeesForStore(storeId?: number): Promise<Array<{
  id: string,
  name: string,
  toast_guid: string
}>> {
  const supabase = await getSupabaseAdminClient();

  let targetToastGuid: string | null = null;
  if (storeId) {
    const { data: store } = await supabase
      .from('stores')
      .select('external_id')
      .eq('id', storeId)
      .single();
    if (store?.external_id) {
      targetToastGuid = store.external_id;
    }
  }

  const { data: jobs } = await supabase.from('toast_jobs').select('*');
  const jobMap = new Map((jobs || []).map((j: any) => [j.guid, (j.title || j.name || '').toLowerCase()]));

  const { data: emps, error } = await supabase
    .from('toast_employees')
    .select('id, toast_guid, first_name, last_name, chosen_name, store_ids, job_references, deleted')
    .eq('deleted', false);

  if (error) throw new Error(error.message);

  // ALLOWLIST: Solo puestos de piso de tienda que portan uniforme
  const ALLOWED_JOB_KEYWORDS = ['cook', 'taquero', 'prep', 'preparador', 'cashier', 'shift leader', 'asst manager', 'asst. manager', 'manager'];
  const SYSTEM_NAMES = ['default online ordering'];

  const filtered = (emps || []).filter((e: any) => {
    // 1. Filtro por tienda
    if (targetToastGuid) {
      if (!e.store_ids) return false;
      const hasStore = Array.isArray(e.store_ids) 
        ? e.store_ids.includes(targetToastGuid)
        : String(e.store_ids).includes(targetToastGuid);
      if (!hasStore) return false;
    }

    // 2. Excluir cuentas de sistema
    const fullName = `${e.chosen_name || e.first_name || ''} ${e.last_name || ''}`.trim().toLowerCase();
    if (SYSTEM_NAMES.some(name => fullName === name)) return false;

    // 3. Solo incluir empleados con AL MENOS un puesto de piso de tienda
    if (e.job_references && Array.isArray(e.job_references) && e.job_references.length > 0) {
      const titles = e.job_references.map((ref: any) => jobMap.get(ref.guid) || '').filter(Boolean);
      if (titles.length > 0) {
        const hasAllowedJob = titles.some((t: string) => ALLOWED_JOB_KEYWORDS.some(k => t.includes(k)));
        return hasAllowedJob;
      }
    }

    // Sin job_references -> no se puede validar, excluir por seguridad
    return false;
  });

  const formatted = filtered.map((e: any) => {
    const firstName = e.chosen_name || e.first_name || '';
    const lastName = e.last_name || '';
    const name = `${firstName} ${lastName}`.trim() || 'Empleado Sin Nombre';
    return {
      id: String(e.id),
      name,
      toast_guid: e.toast_guid || ''
    };
  });

  const uniqueMap = new Map<string, typeof formatted[0]>();
  formatted.forEach(emp => {
    if (!uniqueMap.has(emp.name)) {
      uniqueMap.set(emp.name, emp);
    }
  });

  return Array.from(uniqueMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

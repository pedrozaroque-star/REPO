/**
 * @module safeReconciliationRoute
 * @description API endpoint para obtener el total recolectado de ventas de uniformes por tienda y fecha para cuadrar con la caja fuerte.
 * @businessRules 
 * - Suma las transacciones de tipo 'employee_sale' y 'customer_sale'.
 * - Calcula el total en base a 'total_amount'.
 * - Requiere parámetros query: storeId (número) y businessDate (YYYY-MM-DD).
 * @dataFlow Cliente / Caja Fuerte -> GET API -> Supabase Admin Client -> JSON Response
 * @notes Transacciones anuladas tienen total_amount = 0 por lo que no afectan el monto reconciliado.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const storeIdParam = searchParams.get('storeId');
    const businessDate = searchParams.get('businessDate');

    if (!storeIdParam || !businessDate) {
      return NextResponse.json(
        { error: 'Missing required query parameters: storeId, businessDate' }, 
        { status: 400 }
      );
    }

    const storeId = parseInt(storeIdParam, 10);
    if (isNaN(storeId)) {
      return NextResponse.json(
        { error: 'Invalid storeId, must be numeric' }, 
        { status: 400 }
      );
    }

    const supabase = await getSupabaseAdminClient();

    const { data, error } = await supabase
      .from('uniforms_transactions')
      .select('total_amount')
      .eq('store_id', storeId)
      .eq('business_date', businessDate)
      .in('transaction_type', ['employee_sale', 'customer_sale']);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const transactions = data || [];
    const totalCollected = transactions.reduce(
      (sum: number, tx: { total_amount: number | null }) => sum + (tx.total_amount || 0), 
      0
    );

    const breakdown = transactions.length === 0
      ? 'Sin ventas de uniforme registradas hoy'
      : `${transactions.length} venta(s) de uniforme por un total de $${totalCollected.toFixed(2)}`;

    return NextResponse.json({
      storeId,
      businessDate,
      totalCollected,
      transactionCount: transactions.length,
      breakdown
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * @module safeReconciliationRoute
 * @description API endpoint para obtener el saldo acumulativo exacto de dinero de uniformes en Caja Fuerte por tienda.
 * @businessRules 
 * - El saldo en Caja Fuerte es acumulativo:
 *   totalInSafe = último conteo en safe_counts.uniforms_amount + suma de ventas ('employee_sale', 'customer_sale') posteriores a safe_counts.counted_at.
 * - Si se vende una camisa ($7), gorra ($1) o chamarra ($20), se suma inmediatamente a lo que ya había en la Caja Fuerte y se refleja en ambos módulos (Uniformes y Caja Fuerte).
 * - Cuando se guarda un nuevo conteo en Caja Fuerte, ese total acumulado pasa a ser la nueva base de safe_counts.uniforms_amount.
 * @dataFlow Cliente / Caja Fuerte / Uniformes -> GET API -> fetchUniformsSafeBalance -> JSON Response
 * @notes Transacciones anuladas tienen total_amount = 0 y etiqueta [ANULADO], por lo que se descuentan automáticamente del saldo.
 */

import { NextResponse } from 'next/server';
import { fetchUniformsSafeBalance } from '@/app/inventory/uniforms/actions';
import { getBusinessDate } from '@/app/inventory/uniforms/utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const storeIdParam = searchParams.get('storeId');
    const businessDate = searchParams.get('businessDate') || getBusinessDate();

    if (!storeIdParam) {
      return NextResponse.json(
        { error: 'Missing required query parameter: storeId' }, 
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

    const balance = await fetchUniformsSafeBalance(storeId, businessDate);

    return NextResponse.json({
      storeId: balance.storeId,
      businessDate: balance.businessDate,
      totalCollected: balance.totalInSafe,
      totalInSafe: balance.totalInSafe,
      lastSafeCountId: balance.lastSafeCountId,
      lastSafeCountAmount: balance.lastSafeCountAmount,
      lastSafeCountDate: balance.lastSafeCountDate,
      lastSafeCountShift: balance.lastSafeCountShift,
      accumulatedSalesSinceCount: balance.accumulatedSalesSinceCount,
      salesCountSinceCount: balance.salesCountSinceCount,
      todaySalesAmount: balance.todaySalesAmount,
      todaySalesCount: balance.todaySalesCount,
      transactionCount: balance.salesCountSinceCount,
      breakdown: balance.breakdown,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

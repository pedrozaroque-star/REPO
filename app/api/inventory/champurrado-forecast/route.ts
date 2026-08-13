/**
 * @module champurrado-forecast
 * @description API endpoint que retorna el pronóstico estacional de Champurrado
 *   basado en datos históricos de 5 años (misma semana ISO del calendario).
 * @businessRules
 *   - 1 Galón = 20 vasos/porciones
 *   - Consulta la misma semana del calendario en años anteriores (no solo 3 meses)
 *   - Confidence: HIGH (3+ años), MEDIUM (2 años), LOW (1 año), NONE (sin datos)
 * @dataFlow meat_consumption_history → RPC get_seasonal_avg_gallons → JSON response
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';

function getIsoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId');

  if (!storeId) {
    return NextResponse.json({ error: 'storeId is required' }, { status: 400 });
  }

  const supabase = await getSupabaseAdminClient();

  try {
    // Attempt RPC first
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_seasonal_avg_gallons', {
      p_store_id: storeId,
      p_meat_type: 'CHAMPURRADO'
    });

    if (!rpcError && rpcData) {
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (row) {
        return NextResponse.json({
          suggested_daily_gallons: row.suggested_daily_gallons,
          historical_years_count: row.historical_years_count,
          confidence: row.confidence
        });
      }
    }

    // Fallback if RPC fails or does not exist
    const { data: history, error: historyError } = await supabase
      .from('meat_consumption_history')
      .select('business_date, raw_lbs')
      .eq('store_id', storeId)
      .eq('meat_type', 'CHAMPURRADO');

    if (historyError || !history) {
      return NextResponse.json({
        suggested_daily_gallons: 0,
        historical_years_count: 0,
        confidence: 'NONE'
      });
    }

    const currentWeek = getIsoWeek(new Date());
    let totalLbs = 0;
    const distinctDays = new Set<string>();
    const distinctYears = new Set<number>();

    for (const record of history) {
      const recordDate = new Date(record.business_date);
      if (getIsoWeek(recordDate) === currentWeek) {
        totalLbs += Number(record.raw_lbs);
        distinctDays.add(record.business_date);
        distinctYears.add(recordDate.getFullYear());
      }
    }

    const numDays = distinctDays.size;
    const numYears = distinctYears.size;
    let avgGallons = 0;
    if (numDays > 0) {
      // 1 gallon = 20 lbs/portions
      avgGallons = totalLbs / numDays / 20;
    }

    let confidence = 'NONE';
    if (numYears >= 3) confidence = 'HIGH';
    else if (numYears === 2) confidence = 'MEDIUM';
    else if (numYears === 1) confidence = 'LOW';

    return NextResponse.json({
      suggested_daily_gallons: Math.round(avgGallons * 10) / 10,
      historical_years_count: numYears,
      confidence
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

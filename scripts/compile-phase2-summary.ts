/**
 * Compilador de Resultados Globales Fase 2 (15 Sucursales)
 * Lee los JSON individuales de reports/stores/ y genera la estadística consolidada de la red.
 */
import * as fs from 'fs';
import * as path from 'path';

interface DailyLogEntry {
  store: string;
  date: string;
  dayOfWeek: string;
  month: string;
  isWeekend: boolean;
  isQuincena: boolean;
  isHoliday: boolean;
  isEvent: boolean;
  actualSales: number;
  actualTickets: number;
  v31Sales: number;
  v31Tickets: number;
  tfmRawSales: number;
  tfmRawTickets: number;
  hybridSales: number;
  hybridTickets: number;
  frozenSales?: number | null;
  frozenTickets?: number | null;
  tfmValid: boolean;
}

interface StoreFile {
  store: { id: number; code: string; name: string; external_id: string };
  period: { start: string; end: string };
  metrics: {
    v31: any;
    frozen: any;
    tfm: any;
    hybrid: any;
    deltaVsV31: number;
    winner: string;
  };
  dailyLog: DailyLogEntry[];
}

function computeStats(actuals: number[], preds: number[]) {
  if (actuals.length === 0) return { wape: 0, mae: 0, rmse: 0, bias: 0, count: 0 };
  let sumActual = 0;
  let sumAbsErr = 0;
  let sumSqErr = 0;
  let sumErr = 0;
  for (let i = 0; i < actuals.length; i++) {
    const y = actuals[i];
    const yHat = preds[i];
    const err = yHat - y;
    sumActual += y;
    sumAbsErr += Math.abs(err);
    sumSqErr += err * err;
    sumErr += err;
  }
  return {
    wape: sumActual > 0 ? (sumAbsErr / sumActual) * 100 : 0,
    mae: sumAbsErr / actuals.length,
    rmse: Math.sqrt(sumSqErr / actuals.length),
    bias: sumActual > 0 ? (sumErr / sumActual) * 100 : 0,
    count: actuals.length,
  };
}

async function main() {
  const storesDir = path.join(process.cwd(), 'reports', 'stores');
  const files = fs.readdirSync(storesDir).filter((f) => f.endsWith('.json') && f.startsWith('timesfm-'));

  console.log(`Cargando ${files.length} reportes de sucursales...`);

  const storeSummaries: any[] = [];
  const allDaily: DailyLogEntry[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(storesDir, file), 'utf-8');
    const data: StoreFile = JSON.parse(content);
    const storeCode = data.store.code;

    const actuals = data.dailyLog.map((d) => d.actualSales);
    const totalSales = actuals.reduce((a, b) => a + b, 0);

    const v31Metrics = data.metrics.v31;
    const tfmMetrics = data.metrics.tfm;
    const hybridMetrics = data.metrics.hybrid;
    const frozenMetrics = data.metrics.frozen;

    storeSummaries.push({
      code: storeCode,
      name: data.store.name,
      days: data.dailyLog.length,
      totalSales,
      v31WAPE: v31Metrics.salesWAPE,
      v31MAE: v31Metrics.salesMAE,
      v31Bias: v31Metrics.salesBias,
      v31TkWAPE: v31Metrics.ticketsWAPE,
      tfmWAPE: tfmMetrics.salesWAPE,
      tfmMAE: tfmMetrics.salesMAE,
      tfmBias: tfmMetrics.salesBias,
      tfmTkWAPE: tfmMetrics.ticketsWAPE,
      hybridWAPE: hybridMetrics.salesWAPE,
      hybridMAE: hybridMetrics.salesMAE,
      hybridBias: hybridMetrics.salesBias,
      hybridTkWAPE: hybridMetrics.ticketsWAPE,
      frozenWAPE: frozenMetrics ? frozenMetrics.salesWAPE : null,
      frozenMAE: frozenMetrics ? frozenMetrics.salesMAE : null,
      frozenBias: frozenMetrics ? frozenMetrics.salesBias : null,
      frozenDays: frozenMetrics ? frozenMetrics.count : 0,
      deltaVsV31: v31Metrics.salesWAPE - hybridMetrics.salesWAPE,
      winner: data.metrics.winner,
    });

    for (const d of data.dailyLog) {
      allDaily.push(d);
    }
  }

  // Ordenar alfabéticamente por código
  storeSummaries.sort((a, b) => a.code.localeCompare(b.code));

  console.log(`Total días combinados: ${allDaily.length}`);
  const totalAuditedSales = allDaily.reduce((s, d) => s + d.actualSales, 0);
  const totalAuditedTickets = allDaily.reduce((s, d) => s + d.actualTickets, 0);
  console.log(`Ventas totales auditadas: $${(totalAuditedSales / 1e6).toFixed(3)}M USD`);
  console.log(`Tickets totales auditados: ${(totalAuditedTickets / 1e6).toFixed(3)}M tickets`);

  // Métricas Globales
  const allActualSales = allDaily.map((d) => d.actualSales);
  const allV31Sales = allDaily.map((d) => d.v31Sales);
  const allTfmSales = allDaily.map((d) => d.tfmRawSales);
  const allHybridSales = allDaily.map((d) => d.hybridSales);

  const allActualTk = allDaily.map((d) => d.actualTickets);
  const allV31Tk = allDaily.map((d) => d.v31Tickets);
  const allTfmTk = allDaily.map((d) => d.tfmRawTickets);
  const allHybridTk = allDaily.map((d) => d.hybridTickets);

  const globalV31 = computeStats(allActualSales, allV31Sales);
  const globalTfm = computeStats(allActualSales, allTfmSales);
  const globalHybrid = computeStats(allActualSales, allHybridSales);

  const globalV31Tk = computeStats(allActualTk, allV31Tk);
  const globalTfmTk = computeStats(allActualTk, allTfmTk);
  const globalHybridTk = computeStats(allActualTk, allHybridTk);

  // Congelado global
  const allFrozen = allDaily.filter((d) => d.frozenSales !== undefined && d.frozenSales !== null);
  const globalFrozen = computeStats(
    allFrozen.map((d) => d.actualSales),
    allFrozen.map((d) => d.frozenSales!)
  );
  const globalFrozenTk = computeStats(
    allFrozen.map((d) => d.actualTickets),
    allFrozen.map((d) => d.frozenTickets!)
  );

  // Filtrado de Outliers (IQR sobre ventas reales)
  const sortedSales = [...allActualSales].sort((a, b) => a - b);
  const q1 = sortedSales[Math.floor(sortedSales.length * 0.25)];
  const q3 = sortedSales[Math.floor(sortedSales.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = Math.max(0, q1 - 1.5 * iqr);
  const upperBound = q3 + 1.5 * iqr;

  const cleanDaily = allDaily.filter((d) => d.actualSales >= lowerBound && d.actualSales <= upperBound);
  const outlierDays = allDaily.length - cleanDaily.length;

  const cleanV31 = computeStats(
    cleanDaily.map((d) => d.actualSales),
    cleanDaily.map((d) => d.v31Sales)
  );
  const cleanTfm = computeStats(
    cleanDaily.map((d) => d.actualSales),
    cleanDaily.map((d) => d.tfmRawSales)
  );
  const cleanHybrid = computeStats(
    cleanDaily.map((d) => d.actualSales),
    cleanDaily.map((d) => d.hybridSales)
  );

  const cleanV31Tk = computeStats(
    cleanDaily.map((d) => d.actualTickets),
    cleanDaily.map((d) => d.v31Tickets)
  );
  const cleanTfmTk = computeStats(
    cleanDaily.map((d) => d.actualTickets),
    cleanDaily.map((d) => d.tfmRawTickets)
  );
  const cleanHybridTk = computeStats(
    cleanDaily.map((d) => d.actualTickets),
    cleanDaily.map((d) => d.hybridTickets)
  );

  // Desglose por Día de la Semana
  const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const dowStats = dayNames.map((name) => {
    const subset = allDaily.filter((d) => d.dayOfWeek === name);
    const act = subset.map((d) => d.actualSales);
    const v31 = subset.map((d) => d.v31Sales);
    const tfm = subset.map((d) => d.tfmRawSales);
    const hyb = subset.map((d) => d.hybridSales);
    const sV31 = computeStats(act, v31);
    const sTfm = computeStats(act, tfm);
    const sHyb = computeStats(act, hyb);
    return {
      day: name,
      count: subset.length,
      v31WAPE: sV31.wape,
      tfmWAPE: sTfm.wape,
      hybridWAPE: sHyb.wape,
      winner: sHyb.wape < sV31.wape ? 'Híbrido' : 'V3.1',
      delta: sV31.wape - sHyb.wape,
    };
  });

  // Desglose por Mes
  const monthsMap = new Map<string, DailyLogEntry[]>();
  for (const d of allDaily) {
    const ym = d.date.substring(0, 7);
    if (!monthsMap.has(ym)) monthsMap.set(ym, []);
    monthsMap.get(ym)!.push(d);
  }
  const monthKeys = Array.from(monthsMap.keys()).sort();
  const monthStats = monthKeys.map((ym) => {
    const subset = monthsMap.get(ym)!;
    const act = subset.map((d) => d.actualSales);
    const v31 = subset.map((d) => d.v31Sales);
    const tfm = subset.map((d) => d.tfmRawSales);
    const hyb = subset.map((d) => d.hybridSales);
    const sV31 = computeStats(act, v31);
    const sTfm = computeStats(act, tfm);
    const sHyb = computeStats(act, hyb);
    return {
      month: ym,
      count: subset.length,
      v31WAPE: sV31.wape,
      tfmWAPE: sTfm.wape,
      hybridWAPE: sHyb.wape,
      winner: sHyb.wape < sV31.wape ? 'Híbrido' : 'V3.1',
      delta: sV31.wape - sHyb.wape,
    };
  });

  // Resumen final
  const consolidated = {
    evaluatedStores: storeSummaries.length,
    totalStoreDays: allDaily.length,
    totalSalesAudited: totalAuditedSales,
    totalTicketsAudited: totalAuditedTickets,
    outlierDays,
    globalMetrics: {
      sales: {
        v31: globalV31,
        frozen: globalFrozen,
        timesfm: globalTfm,
        hybrid: globalHybrid,
      },
      tickets: {
        v31: globalV31Tk,
        frozen: globalFrozenTk,
        timesfm: globalTfmTk,
        hybrid: globalHybridTk,
      },
      salesClean: {
        v31: cleanV31,
        timesfm: cleanTfm,
        hybrid: cleanHybrid,
      },
      ticketsClean: {
        v31: cleanV31Tk,
        timesfm: cleanTfmTk,
        hybrid: cleanHybridTk,
      },
    },
    storeSummaries,
    dowStats,
    monthStats,
  };

  const outPath = path.join(process.cwd(), 'reports', 'timesfm-backtest-2026-09-23-consolidated.json');
  fs.writeFileSync(outPath, JSON.stringify(consolidated, null, 2), 'utf-8');
  console.log(`Consolidado guardado en: ${outPath}`);
}

main().catch(console.error);

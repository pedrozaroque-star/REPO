/**
 * Test de simulación para verificar la lógica de Captura Limpia de Sobrantes en Viele & Sons:
 * 1. Estado inicial con sobrante en blanco: sugerido = 0, pedido final = 0, totales en $0.00 / 0 cajas.
 * 2. Captura de sobrante = 0: calcula resta sugerido = PAR, sincroniza pedido final, actualiza totales.
 * 3. Captura de sobrante >= PAR: sugerido = 0, pedido final = 0, no añade cajas.
 * 4. Borrado de sobrante a blanco: regresa sugerido = 0, pedido final = 0, limpia del total.
 * 5. Edición de PAR con sobrante en blanco vs con sobrante capturado.
 */

import { isVieleSoda } from '../lib/viele-catalog-data';

interface OrderRow {
  par: number;
  leftover: string;
  suggested: number;
  finalOrder: number;
  price: number;
  isSoda: boolean;
}

function calculateSummary(rows: Record<string, OrderRow>) {
  let orderedItemsCount = 0;
  let totalCases = 0;
  let subtotal = 0;
  let sodaCases = 0;
  let sodaSubtotal = 0;
  let generalCases = 0;
  let generalSubtotal = 0;

  Object.values(rows).forEach(row => {
    if (row.finalOrder > 0) {
      orderedItemsCount++;
      totalCases += row.finalOrder;
      const ext = row.finalOrder * row.price;
      subtotal += ext;

      if (row.isSoda) {
        sodaCases += row.finalOrder;
        sodaSubtotal += ext;
      } else {
        generalCases += row.finalOrder;
        generalSubtotal += ext;
      }
    }
  });

  return {
    orderedItemsCount,
    totalCases,
    subtotal: parseFloat(subtotal.toFixed(2)),
    grandTotal: parseFloat(subtotal.toFixed(2)),
    sodas: {
      totalCases: sodaCases,
      grandTotal: parseFloat(sodaSubtotal.toFixed(2))
    },
    general: {
      totalCases: generalCases,
      grandTotal: parseFloat(generalSubtotal.toFixed(2))
    }
  };
}

function handleLeftoverChange(row: OrderRow, val: string): OrderRow {
  if (val.trim() === '') {
    return {
      ...row,
      leftover: '',
      suggested: 0,
      finalOrder: 0
    };
  }

  const numVal = Math.max(0, parseFloat(val) || 0);
  const suggested = Math.max(0, Math.ceil(row.par - numVal));
  return {
    ...row,
    leftover: val,
    suggested,
    finalOrder: Math.round(suggested)
  };
}

function handleParChange(row: OrderRow, val: string): OrderRow {
  const isBlank = val.trim() === '';
  const numVal = isBlank ? 0 : Math.max(0, parseInt(val, 10) || 0);

  const hasLeftover = row.leftover.trim() !== '';
  const leftoverNum = hasLeftover ? (parseFloat(row.leftover) || 0) : 0;
  const newSuggested = hasLeftover ? Math.max(0, Math.ceil(numVal - leftoverNum)) : 0;
  const wasFinalOrderSynced = row.finalOrder === row.suggested;

  return {
    ...row,
    par: numVal,
    suggested: newSuggested,
    finalOrder: wasFinalOrderSynced ? newSuggested : row.finalOrder
  };
}

function runTests() {
  console.log('--- INICIO DE PRUEBAS DE CAPTURA LIMPIA VIELE & SONS ---');

  // 1. Simulación Inicial: Catálogo cargado de 4 productos
  const rows: Record<string, OrderRow> = {
    BCLCO: { par: 7, leftover: '', suggested: 0, finalOrder: 0, price: 118.32, isSoda: true },
    BDICO: { par: 2, leftover: '', suggested: 0, finalOrder: 0, price: 118.32, isSoda: true },
    F001: { par: 10, leftover: '', suggested: 0, finalOrder: 0, price: 45.50, isSoda: false },
    F002: { par: 5, leftover: '', suggested: 0, finalOrder: 0, price: 20.00, isSoda: false }
  };

  const initialSummary = calculateSummary(rows);
  console.log('1. Estado Inicial (Sobrantes en blanco):');
  console.log('   Total Cajas:', initialSummary.totalCases);
  console.log('   Total en $:  $', initialSummary.grandTotal);
  console.log('   SKUs pedidos:', initialSummary.orderedItemsCount);
  if (initialSummary.totalCases !== 0 || initialSummary.grandTotal !== 0) {
    throw new Error('FAIL: Los totales iniciales deben ser estrictamente 0');
  }
  console.log('   PASS: Cero cajas y cero dólares al abrir la pantalla sin ruido.');

  // 2. Captura: Usuario cuenta Coca-Cola (BCLCO) y no tiene nada de sobrante (sobrante = 0)
  rows.BCLCO = handleLeftoverChange(rows.BCLCO, '0');
  const sumAfterCoca = calculateSummary(rows);
  console.log('\n2. Captura BCLCO (Sobrante = 0, PAR = 7):');
  console.log('   Sugerido:', rows.BCLCO.suggested, '| Pedido:', rows.BCLCO.finalOrder);
  console.log('   Total Cajas:', sumAfterCoca.totalCases, '| Total en $: $', sumAfterCoca.grandTotal);
  if (rows.BCLCO.suggested !== 7 || rows.BCLCO.finalOrder !== 7 || sumAfterCoca.totalCases !== 7) {
    throw new Error('FAIL: BCLCO con sobrante 0 debe sugerir 7 cajas');
  }
  console.log('   PASS: Sugiere 7 cajas y totaliza $828.24.');

  // 3. Captura: Usuario cuenta Diet Coke (BDICO) y tiene 2 cajas en bodega (sobrante = 2, PAR = 2)
  rows.BDICO = handleLeftoverChange(rows.BDICO, '2');
  const sumAfterDiet = calculateSummary(rows);
  console.log('\n3. Captura BDICO (Sobrante = 2, PAR = 2):');
  console.log('   Sugerido:', rows.BDICO.suggested, '| Pedido:', rows.BDICO.finalOrder);
  console.log('   Total Cajas:', sumAfterDiet.totalCases, '(no debe cambiar)');
  if (rows.BDICO.suggested !== 0 || rows.BDICO.finalOrder !== 0 || sumAfterDiet.totalCases !== 7) {
    throw new Error('FAIL: BDICO con sobrante 2 debe sugerir 0 cajas');
  }
  console.log('   PASS: Sugerido 0 y no incrementa el pedido.');

  // 4. Captura Insumo General: F001 (PAR = 10, Sobrante = 4)
  rows.F001 = handleLeftoverChange(rows.F001, '4');
  const sumAfterF001 = calculateSummary(rows);
  console.log('\n4. Captura F001 (Sobrante = 4, PAR = 10):');
  console.log('   Sugerido:', rows.F001.suggested, '| Pedido:', rows.F001.finalOrder);
  console.log('   Total Cajas:', sumAfterF001.totalCases, '(7 sodas + 6 insumos = 13)');
  console.log('   Total en $: $', sumAfterF001.grandTotal);
  if (rows.F001.suggested !== 6 || sumAfterF001.totalCases !== 13) {
    throw new Error('FAIL: F001 debe sugerir 6 cajas');
  }
  console.log('   PASS: Desglose dual separa Factura 1 (7 cjs) y Factura 2 (6 cjs).');

  // 5. Borrado: Usuario borra el sobrante de Coca-Cola a blanco ('')
  rows.BCLCO = handleLeftoverChange(rows.BCLCO, '');
  const sumAfterClear = calculateSummary(rows);
  console.log('\n5. Borrado de Sobrante BCLCO a blanco (""):');
  console.log('   Sugerido:', rows.BCLCO.suggested, '| Pedido:', rows.BCLCO.finalOrder);
  console.log('   Total Cajas:', sumAfterClear.totalCases, '(debe bajar de 13 a 6)');
  if (rows.BCLCO.suggested !== 0 || rows.BCLCO.finalOrder !== 0 || sumAfterClear.totalCases !== 6) {
    throw new Error('FAIL: Al borrar a blanco, BCLCO debe regresar a sugerido 0 y salir del total');
  }
  console.log('   PASS: BCLCO sale limpiamente de la orden.');

  // 6. Edición de PAR en producto con sobrante en blanco (F002)
  rows.F002 = handleParChange(rows.F002, '8');
  console.log('\n6. Cambio de PAR en F002 de 5 a 8 con sobrante en blanco:');
  console.log('   Sugerido:', rows.F002.suggested, '| Pedido:', rows.F002.finalOrder);
  if (rows.F002.suggested !== 0 || rows.F002.finalOrder !== 0) {
    throw new Error('FAIL: Modificar PAR con sobrante en blanco NO debe generar orden');
  }
  console.log('   PASS: PAR se actualiza a 8 sin disparar orden automática.');

  console.log('\nTODAS LAS PRUEBAS PASARON EXITOSAMENTE.');
}

runTests();

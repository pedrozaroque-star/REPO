/**
 * @file test-quickbooks-bills-audit.ts
 * @description Script de simulación y auditoría exhaustiva en tiempo real para el módulo Crear Bills.
 * Valida:
 * 1. Coherencia relacional del catálogo estático contra la base de datos de Supabase.
 * 2. Pruebas de límites de fechas y saltos de mes / bisiestos.
 * 3. Consultas reales a QuickBooks Online (Invoices y Bills).
 * 4. Precisión matemática y prevención de NaN/Infinity.
 * 5. Lógica anti-duplicados e idempotencia.
 */

import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';
import {
    STORE_QB_MAPPINGS,
    STORE_QB_MAPPINGS_BY_STORE_ID,
    findMappingByCustomer,
    WAREHOUSE_VENDOR_ID,
    COGS_ACCOUNT_ID,
    SALES_TERM_ID,
    AP_ACCOUNT_ID
} from '../types/quickbooks-bills';
import {
    getWarehouseInvoicesWithBills,
    createQuickBooksBillForInvoice,
    addDaysToDateString
} from '../lib/quickbooks-bills';

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
}

const results: TestResult[] = [];

function assert(name: string, condition: boolean, details: string = '') {
    results.push({
        name,
        passed: condition,
        details: condition ? 'OK' : `FALLÓ: ${details}`
    });
    if (!condition) {
        console.error(`❌ [FALLO] ${name}: ${details}`);
    } else {
        console.log(`✅ [ÉXITO] ${name}`);
    }
}

async function runAuditSimulation() {
    console.log('===============================================================');
    console.log('🧪 INICIANDO AUDITORÍA Y SIMULACIÓN EN TIEMPO REAL: CREAR BILLS');
    console.log('===============================================================\n');

    // -------------------------------------------------------------
    // PRUEBA 1: Integridad del catálogo contra DB Supabase
    // -------------------------------------------------------------
    console.log('--- 1. Validación Relacional: Supabase DB vs STORE_QB_MAPPINGS ---');
    const { data: dbStores, error: dbError } = await supabaseAdmin
        .from('stores')
        .select('id, name, code')
        .order('id');

    assert('Conexión con Supabase stores', !dbError && !!dbStores, dbError?.message || 'No se obtuvieron tiendas');

    if (dbStores) {
        assert('Cantidad de tiendas en DB es 15', dbStores.length === 15, `Se encontraron ${dbStores.length} tiendas`);
        
        let allStoresMapped = true;
        let missingStore = '';
        for (const store of dbStores) {
            const strId = String(store.id);
            const mapping = STORE_QB_MAPPINGS_BY_STORE_ID[strId];
            if (!mapping) {
                allStoresMapped = false;
                missingStore = `Tienda ID ${strId} (${store.name}) no encontrada en STORE_QB_MAPPINGS_BY_STORE_ID`;
                break;
            }
            if (!mapping.qbCustomerId || !mapping.qbDepartmentId || !mapping.qbClassId) {
                allStoresMapped = false;
                missingStore = `Tienda ID ${strId} (${store.name}) tiene campos QBO incompletos (Customer: ${mapping.qbCustomerId}, Dept: ${mapping.qbDepartmentId}, Class: ${mapping.qbClassId})`;
                break;
            }
        }
        assert('Todas las 15 tiendas de Supabase tienen mapeo QBO completo', allStoresMapped, missingStore);
    }

    // -------------------------------------------------------------
    // PRUEBA 2: Función findMappingByCustomer con variaciones de texto
    // -------------------------------------------------------------
    console.log('\n--- 2. Pruebas de Búsqueda de Mapeo (findMappingByCustomer) ---');
    const m1 = findMappingByCustomer('1100');
    assert('Búsqueda por customerId exacto (1100 -> Azusa)', m1?.storeName === 'Azusa', `Obtenido: ${m1?.storeName}`);

    const m2 = findMappingByCustomer(undefined, 'Azusa-TEG');
    assert('Búsqueda por customerName exacto (Azusa-TEG)', m2?.storeName === 'Azusa', `Obtenido: ${m2?.storeName}`);

    const m3 = findMappingByCustomer(undefined, 'azusa-teg');
    assert('Búsqueda por customerName minúsculas (azusa-teg)', m3?.storeName === 'Azusa', `Obtenido: ${m3?.storeName}`);

    const m4 = findMappingByCustomer(undefined, '  LYNWOOD-TEG  ');
    assert('Búsqueda por customerName con espacios y mayúsculas', m4?.storeName === 'Lynwood', `Obtenido: ${m4?.storeName}`);

    const m5 = findMappingByCustomer('999999', 'Tienda Inexistente');
    assert('Búsqueda con cliente no existente retorna null', m5 === null, `Retornó: ${JSON.stringify(m5)}`);

    // -------------------------------------------------------------
    // PRUEBA 3: Cálculos de Fechas (addDaysToDateString)
    // -------------------------------------------------------------
    console.log('\n--- 3. Pruebas de Aritmética de Fechas (addDaysToDateString) ---');
    // Mes normal
    const d1 = addDaysToDateString('2026-10-01', 30);
    assert('Fecha normal: 2026-10-01 + 30 días = 2026-10-31', d1 === '2026-10-31', `Obtenido: ${d1}`);

    // Cambio de mes
    const d2 = addDaysToDateString('2026-10-15', 30);
    assert('Salto de mes: 2026-10-15 + 30 días = 2026-11-14', d2 === '2026-11-14', `Obtenido: ${d2}`);

    // Salto de año
    const d3 = addDaysToDateString('2026-12-15', 30);
    assert('Salto de año: 2026-12-15 + 30 días = 2027-01-14', d3 === '2027-01-14', `Obtenido: ${d3}`);

    // Febrero en año no bisiesto (2026 no es bisiesto, feb tiene 28 días)
    const d4 = addDaysToDateString('2026-02-01', 30);
    assert('Febrero no bisiesto: 2026-02-01 + 30 días = 2026-03-03', d4 === '2026-03-03', `Obtenido: ${d4}`);

    // -------------------------------------------------------------
    // PRUEBA 4: Consulta Real a QuickBooks Online
    // -------------------------------------------------------------
    console.log('\n--- 4. Consulta en Vivo a QuickBooks Online (getWarehouseInvoicesWithBills) ---');
    const t0 = Date.now();
    let invoices: any[] = [];
    try {
        invoices = await getWarehouseInvoicesWithBills({ limit: 20 });
        const elapsed = Date.now() - t0;
        assert('Consulta a QBO exitosa en < 15 segundos', invoices.length >= 0 && elapsed < 15000, `Demoró ${elapsed}ms, ${invoices.length} facturas`);
    } catch (err: any) {
        assert('Consulta a QBO exitosa', false, err.message);
    }

    if (invoices.length > 0) {
        console.log(`ℹ️ Se obtuvieron ${invoices.length} facturas recientes de Bodega.`);
        const first = invoices[0];
        console.log(`   Ejemplo Invoice #${first.docNumber}: Tienda: ${first.storeName}, Monto: $${first.totalAmount}, Bill: ${first.hasBill ? 'Creado (ID ' + first.bill?.billId + ')' : 'Pendiente'}`);

        assert('Invoice tiene docNumber no vacío', typeof first.docNumber === 'string' && first.docNumber.length > 0, `DocNumber: ${first.docNumber}`);
        assert('Invoice tiene totalAmount numérico válido y > 0', typeof first.totalAmount === 'number' && !isNaN(first.totalAmount) && first.totalAmount > 0, `Monto: ${first.totalAmount}`);
        assert('Invoice tiene storeName asignado', typeof first.storeName === 'string' && first.storeName.length > 0, `StoreName: ${first.storeName}`);
        assert('hasBill es de tipo boolean estricto', typeof first.hasBill === 'boolean', `hasBill: ${first.hasBill}`);

        // Verificar consistencia de bill si hasBill === true
        const withBill = invoices.find(inv => inv.hasBill);
        if (withBill) {
            assert('Si hasBill es true, bill contiene billId válido', !!withBill.bill?.billId, `billId: ${withBill.bill?.billId}`);
            assert('Si hasBill es true, bill.docNumber coincide con invoice.docNumber', withBill.bill?.docNumber === withBill.docNumber, `Bill doc: ${withBill.bill?.docNumber} vs Inv doc: ${withBill.docNumber}`);
        }

        // -------------------------------------------------------------
        // PRUEBA 5: Protección Anti-Duplicados en Vivo
        // -------------------------------------------------------------
        console.log('\n--- 5. Prueba de Prevención Anti-Duplicados (Idempotencia) ---');
        const targetDoc = withBill ? withBill.docNumber : '58212';
        console.log(`ℹ️ Probando protección anti-duplicados con DocNumber: #${targetDoc}`);
        try {
            const res = await createQuickBooksBillForInvoice(targetDoc);
            if (!res.success) {
                const isDuplicateError = (res.error || '').toLowerCase().includes('ya existe') || (res.error || '').toLowerCase().includes('duplicate');
                assert('createQuickBooksBillForInvoice rechaza factura duplicada correctamente', isDuplicateError, `Mensaje recibido: ${res.error}`);
            } else {
                assert('createQuickBooksBillForInvoice debe rechazar invoices que ya tienen Bill', false, `Permitió crear duplicado con ID: ${res.bill?.Id}`);
            }
        } catch (dupErr: any) {
            const isDuplicateError = dupErr.message.toLowerCase().includes('ya existe un bill');
            assert('createQuickBooksBillForInvoice rechaza factura duplicada con excepción', isDuplicateError, `Mensaje: ${dupErr.message}`);
        }
    }

    // -------------------------------------------------------------
    // PRUEBA 6: Constantes de Configuración Contable
    // -------------------------------------------------------------
    console.log('\n--- 6. Verificación de Parámetros Contables Requeridos ---');
    assert('Vendor ID de Bodega es 116', WAREHOUSE_VENDOR_ID === '116', WAREHOUSE_VENDOR_ID);
    assert('Cuenta COGS es 71 (50010 COGS Purchases:Prep Foods)', COGS_ACCOUNT_ID === '71', COGS_ACCOUNT_ID);
    assert('Término de pago es 10 ("15" Net 30)', SALES_TERM_ID === '10', SALES_TERM_ID);
    assert('Cuenta de Pasivo AP es 54 (Accounts Payable)', AP_ACCOUNT_ID === '54', AP_ACCOUNT_ID);

    // -------------------------------------------------------------
    // RESUMEN FINAL
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log('📊 RESUMEN FINAL DE LA AUDITORÍA');
    console.log('===============================================================');
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;
    console.log(`Total de Pruebas: ${total} | Aprobadas: ${passed} | Fallidas: ${failed}`);
    if (failed === 0) {
        console.log('🎉 TODAS LAS PRUEBAS DE AUDITORÍA PASARON EXITOSAMENTE (100%)');
    } else {
        console.error(`⚠️ SE ENCONTRARON ${failed} OBSERVACIONES QUE DEBEN SER ATENDIDAS.`);
        process.exit(1);
    }
}

runAuditSimulation().catch(err => {
    console.error('Error fatal durante la auditoría:', err);
    process.exit(1);
});

/**
 * @module QuickBooksVieleBillsAPI
 * @description Endpoint REST para listar las 3 facturas semanales de Viele & Sons (Sodas, Insumos Generales
 *              y Químicos Imperial Chemical) sincronizadas desde Wholesail, vincular tokens por tienda o cuenta,
 *              y crear sus Bills automáticamente en QuickBooks Online (Vendor ID '1': "Viele & Sons").
 *
 * @businessRules
 * - Requiere sesión autenticada válida (`verifySessionToken`) con acceso administrativo, contable o de compras.
 * - GET: Devuelve facturas de Viele & Sons desde Wholesail cruzadas con Bills de QBO (`VendorRef = '1'`),
 *   KPIs desglosados por categoría (`SODAS`, `SUPPLIES`, `SUPPLIES_SPLIT`, `CHEMICALS`) y estado de conexión Wholesail por tienda.
 * - POST:
 *   1) `action = 'connect_wholesail_link'`: Registra el enlace/token `_wsrt` de Wholesail en Supabase (`integrations`).
 *   2) `action = 'request_wholesail_passcode'`: Envía código de 6 dígitos al correo corporativo (`ap@tacosgavilan.com`).
 *   3) `action = 'verify_wholesail_passcode'`: Verifica el código de 6 dígitos y vincula automáticamente las 15 tiendas.
 *   4) Creación de Bills (individual o en lote): Asigna `VendorRef = '1'`, `SalesTermRef = '4'` (`Net 60`, `DueDate = TxnDate + 60`),
 *      cuentas contables (`50001 Beverages`, `53050 Restaurant Supplies`, `51170 Janitorial Supplies` con split automático de `3BLEA`),
 *      `DepartmentRef` (Location) y `ClassRef` (Class).
 *
 * @dataFlow
 * - UI (`app/admin/crear-bills/page.tsx`) -> `/api/quickbooks/viele-bills` -> `lib/viele-wholesail-bills.ts` -> Wholesail API & QuickBooks Online API.
 *
 * @notes
 * - Soporta creación individual y por lote con validación anti-duplicados por `DocNumber` (sin el sufijo `-IN`).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    createQuickBooksBillsForVieleBatch,
    CreateVieleBillInput,
    fetchVieleWholesailInvoicesWithBillStatus,
    registerWholesailLinkOrToken,
    requestWholesailPasscode,
    STORE_QB_MAPPINGS,
    verifyWholesailPasscode
} from '@/lib/viele-wholesail-bills';
import { VieleInvoiceCategory } from '@/types/quickbooks-bills';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {

        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('startDate') || undefined;
        const endDate = searchParams.get('endDate') || undefined;
        const storeId = searchParams.get('storeId') || 'all';
        const status = (searchParams.get('status') || 'all') as 'all' | 'pending' | 'created';
        const category = (searchParams.get('category') || 'all') as 'all' | VieleInvoiceCategory;
        const refresh = searchParams.get('refresh') === 'true';

        const { records, storeStatuses } = await fetchVieleWholesailInvoicesWithBillStatus({
            startDate,
            endDate,
            storeId,
            status,
            category,
            refresh
        });

        const totalInvoices = records.length;
        const pendingBills = records.filter((r) => !r.hasBill).length;
        const createdBills = records.filter((r) => r.hasBill).length;
        const totalAmount = Number(records.reduce((acc, r) => acc + r.totalAmount, 0).toFixed(2));
        const pendingAmount = Number(
            records.filter((r) => !r.hasBill).reduce((acc, r) => acc + r.totalAmount, 0).toFixed(2)
        );
        const createdAmount = Number(
            records.filter((r) => r.hasBill).reduce((acc, r) => acc + r.totalAmount, 0).toFixed(2)
        );

        const sodasCount = records.filter((r) => r.category === 'SODAS').length;
        const suppliesCount = records.filter(
            (r) => r.category === 'SUPPLIES' || r.category === 'SUPPLIES_SPLIT'
        ).length;
        const chemicalsCount = records.filter((r) => r.category === 'CHEMICALS').length;
        const connectedStoresCount = storeStatuses.filter((s) => s.connected).length;

        return NextResponse.json({
            success: true,
            records,
            summary: {
                totalInvoices,
                pendingBills,
                createdBills,
                totalAmount,
                pendingAmount,
                createdAmount,
                sodasCount,
                suppliesCount,
                chemicalsCount,
                connectedStoresCount
            },
            stores: Object.values(STORE_QB_MAPPINGS).sort((a, b) => a.storeName.localeCompare(b.storeName)),
            storeStatuses
        });
    } catch (error: any) {
        console.error('[QuickBooksVieleBillsAPI GET] Error:', error);
        return NextResponse.json(
            { error: error?.message || 'Error fetching Viele & Sons Wholesail invoices' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const action = String(body?.action || 'create_bills');

        if (action === 'connect_wholesail_link') {
            const urlOrToken = String(body?.urlOrToken || '').trim();
            const explicitStoreId = body?.storeId ? Number(body.storeId) : undefined;
            const result = await registerWholesailLinkOrToken(urlOrToken, explicitStoreId);
            return NextResponse.json({
                success: true,
                connectedStores: result.connectedStores
            });
        }

        if (action === 'request_wholesail_passcode') {
            const emailAddress = String(body?.emailAddress || 'ap@tacosgavilan.com').trim();
            const result = await requestWholesailPasscode(emailAddress);
            return NextResponse.json({
                success: true,
                emailAddress: result.emailAddress
            });
        }

        if (action === 'verify_wholesail_passcode') {
            const code = String(body?.code || '').trim();
            const emailAddress = String(body?.emailAddress || 'ap@tacosgavilan.com').trim();
            const result = await verifyWholesailPasscode(code, emailAddress);
            return NextResponse.json({
                success: true,
                connectedStores: result.connectedStores
            });
        }

        // Default action: create single or batch Bills in QuickBooks Online
        const rawList: any[] = Array.isArray(body?.invoices)
            ? body.invoices
            : body?.docNumber
              ? [body]
              : [];

        if (rawList.length === 0) {
            return NextResponse.json(
                { error: 'No invoices provided to create Viele & Sons Bills' },
                { status: 400 }
            );
        }

        const sanitizedInvoices: CreateVieleBillInput[] = rawList.map((item) => ({
            docNumber: String(item.docNumber || '').trim(),
            txnDate: String(item.txnDate || '').trim(),
            totalAmount: Number(item.totalAmount),
            storeId: String(item.storeId || '').trim(),
            poNumber: item.poNumber ? String(item.poNumber).trim() : undefined,
            expenseSplits: Array.isArray(item.expenseSplits)
                ? item.expenseSplits.map((s: any) => ({
                      accountId: String(s.accountId || '').trim(),
                      accountName: String(s.accountName || '').trim(),
                      amount: Number(s.amount),
                      description: s.description ? String(s.description) : undefined
                  }))
                : []
        }));

        const results = await createQuickBooksBillsForVieleBatch(sanitizedInvoices);

        const createdCount = results.filter((r) => r.success && !r.alreadyExisted).length;
        const alreadyExistedCount = results.filter((r) => r.success && r.alreadyExisted).length;
        const failedCount = results.filter((r) => !r.success).length;

        return NextResponse.json({
            success: failedCount === 0,
            summary: {
                totalRequested: sanitizedInvoices.length,
                createdCount,
                alreadyExistedCount,
                failedCount
            },
            results
        });
    } catch (error: any) {
        console.error('[QuickBooksVieleBillsAPI POST] Error:', error);
        return NextResponse.json(
            { error: error?.message || 'Error processing Viele & Sons Bills request' },
            { status: 500 }
        );
    }
}

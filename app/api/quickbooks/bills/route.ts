/**
 * @module ApiQuickBooksBills
 * @description API route para listar invoices de Bodega con estado de Bills y para crear Bills en QuickBooks Online.
 * 
 * @businessRules
 * - GET: Retorna las facturas de la bodega hacia las tiendas con su estatus de Bill (creado o pendiente).
 * - POST: Crea uno o varios Bills en QuickBooks Online a partir de los Invoices seleccionados.
 * - Validación: Previene duplicados verificando si ya existe un Bill para el DocNumber y Vendor 116.
 * - Mapeo: Asigna automáticamente Department (Location) y Class de acuerdo a la tienda del cliente.
 * 
 * @dataFlow
 * - Frontend (/admin/crear-bills) -> /api/quickbooks/bills -> lib/quickbooks-bills.ts -> QuickBooks Online API v3
 * 
 * @notes
 * - Soporta creación individual y por lote (batch).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    getWarehouseInvoicesWithBills,
    createQuickBooksBillForInvoice
} from '@/lib/quickbooks-bills';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const storeId = searchParams.get('storeId') || undefined;
        const startDate = searchParams.get('startDate') || undefined;
        const endDate = searchParams.get('endDate') || undefined;
        const limitStr = searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : 100;

        const records = await getWarehouseInvoicesWithBills({
            storeId,
            startDate,
            endDate,
            limit
        });

        // Compute summary metrics
        let pendingCount = 0;
        let createdCount = 0;
        let pendingAmount = 0;
        let createdAmount = 0;
        let totalAmount = 0;

        records.forEach((r) => {
            totalAmount += r.totalAmount;
            if (r.hasBill) {
                createdCount++;
                createdAmount += r.totalAmount;
            } else {
                pendingCount++;
                pendingAmount += r.totalAmount;
            }
        });

        return NextResponse.json({
            success: true,
            invoices: records,
            summary: {
                totalCount: records.length,
                pendingCount,
                createdCount,
                pendingAmount,
                createdAmount,
                totalAmount
            }
        });
    } catch (error: any) {
        console.error('Error fetching warehouse bills/invoices:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Error al obtener facturas de QuickBooks'
            },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { invoiceDocNumbers, customOptions } = body;

        if (!invoiceDocNumbers || !Array.isArray(invoiceDocNumbers) || invoiceDocNumbers.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Debe especificar al menos un número de factura (invoiceDocNumbers)' },
                { status: 400 }
            );
        }

        const results: Array<{
            docNumber: string;
            success: boolean;
            bill?: any;
            error?: string;
        }> = [];

        for (const docNumber of invoiceDocNumbers) {
            try {
                const res = await createQuickBooksBillForInvoice(String(docNumber), customOptions);
                results.push({
                    docNumber: String(docNumber),
                    success: res.success,
                    bill: res.bill,
                    error: res.error
                });
            } catch (err: any) {
                results.push({
                    docNumber: String(docNumber),
                    success: false,
                    error: err.message || 'Error inesperado al crear el Bill'
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        return NextResponse.json({
            success: successCount > 0,
            summary: {
                total: results.length,
                successCount,
                failCount
            },
            results
        });
    } catch (error: any) {
        console.error('Error processing Bill creation:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Error al procesar la creación de Bills'
            },
            { status: 500 }
        );
    }
}

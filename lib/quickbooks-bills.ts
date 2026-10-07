/**
 * @module QuickBooksBills
 * @description Módulo de sincronización y creación de Bills en QuickBooks Online a partir de Invoices emitidos por La Bodega Central (Tacos Gavilan - Warehouse) a cada sucursal.
 * 
 * @businessRules
 * - La Bodega Central emite facturas (Invoices) a cada una de las 15 sucursales (registradas como Customers en QuickBooks bajo el sufijo -TEG).
 * - Para la contabilidad de costos de cada tienda, se debe registrar un Bill por cada Invoice.
 * - Parámetros requeridos del Bill:
 *   - Vendor: "Tacos El Gavilan - Warehouse" (ID: 116).
 *   - DocNumber (Bill no): El número exacto del Invoice (ej: "58211").
 *   - TxnDate (Bill date): La fecha del Invoice (TxnDate).
 *   - DueDate (Due date): 30 días posteriores a la fecha del Bill (según Términos "15" / Net 30 DueDays).
 *   - SalesTermRef: "10" (Término "15" en QBO).
 *   - DepartmentRef (Location): El departamento en QBO que corresponde a la sucursal (ej: Azusa -> 12).
 *   - APAccountRef: "54" (Accounts Payable).
 *   - Line Category: "50010 COGS Purchases:Prep Foods" (Account ID: 71).
 *   - ClassRef: La clase en QBO que corresponde a la sucursal (ej: Azusa -> 2200000000000075341).
 *   - Amount: El monto total exacto del Invoice.
 * - Prevención de duplicados: NUNCA crear más de un Bill con el mismo DocNumber para el Vendor 116.
 * 
 * @dataFlow
 * - QuickBooks Online API v3 (Invoices, Bills, Customers, Departments, Classes) via node-quickbooks.
 * - Mapeo estricto de las 15 tiendas de Supabase hacia sus IDs de QBO.
 * 
 * @notes
 * - La búsqueda de Invoices y Bills en node-quickbooks usa cadenas SQL para soporte de ORDERBY y filtros.
 * - Mapeo 100% verificado contra las transacciones reales en el ambiente de producción de QBO.
 */

import { getQuickBooksClient } from './quickbooks';

import {
    type StoreQBMappings,
    WAREHOUSE_VENDOR_ID,
    WAREHOUSE_VENDOR_NAME,
    COGS_ACCOUNT_ID,
    COGS_ACCOUNT_NAME,
    SALES_TERM_ID,
    AP_ACCOUNT_ID,
    STORE_QB_MAPPINGS,
    STORE_QB_MAPPINGS_BY_STORE_ID,
    findMappingByCustomer,
    type WarehouseInvoiceRecord
} from '@/types/quickbooks-bills';

export {
    type StoreQBMappings,
    WAREHOUSE_VENDOR_ID,
    WAREHOUSE_VENDOR_NAME,
    COGS_ACCOUNT_ID,
    COGS_ACCOUNT_NAME,
    SALES_TERM_ID,
    AP_ACCOUNT_ID,
    STORE_QB_MAPPINGS,
    STORE_QB_MAPPINGS_BY_STORE_ID,
    findMappingByCustomer,
    type WarehouseInvoiceRecord
};

/**
 * Calculates due date adding specified number of days to a YYYY-MM-DD date string.
 */
export function addDaysToDateString(dateStr: string, days: number = 30): string {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        d.setDate(d.getDate() + days);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

/**
 * Fetches recent invoices from QuickBooks and matches them with bills created for Vendor 116 (Warehouse).
 */
export async function getWarehouseInvoicesWithBills(options?: {
    storeId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
}): Promise<WarehouseInvoiceRecord[]> {
    const qbo = await getQuickBooksClient();
    const limit = options?.limit || 150;

    // Filter to only invoices that belong to our store customers (or specific store if specified)
    let targetStoreMapping: StoreQBMappings | null = null;
    if (options?.storeId) {
        targetStoreMapping = STORE_QB_MAPPINGS_BY_STORE_ID[options.storeId] || null;
    }

    // 1. Fetch Invoices from QBO
    const whereConditions: string[] = [];
    if (targetStoreMapping) {
        whereConditions.push(`CustomerRef = '${targetStoreMapping.qbCustomerId}'`);
    }
    if (options?.startDate) {
        whereConditions.push(`TxnDate >= '${options.startDate}'`);
    }
    if (options?.endDate) {
        whereConditions.push(`TxnDate <= '${options.endDate}'`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')} ` : '';
    const invoiceQuery = `${whereClause}ORDERBY TxnDate DESC, MetaData.CreateTime DESC MAXRESULTS ${limit}`;

    const invoicesData: any = await new Promise((resolve, reject) => {
        qbo.findInvoices(invoiceQuery, (err: any, data: any) => {
            if (err) reject(err);
            else resolve(data);
        });
    });

    const qbInvoices = invoicesData?.QueryResponse?.Invoice || [];

    const filteredInvoices = qbInvoices.filter((inv: any) => {
        const custId = inv.CustomerRef?.value;
        const custName = inv.CustomerRef?.name;
        const mapping = findMappingByCustomer(custId, custName);
        if (!mapping) return false;
        if (targetStoreMapping && mapping.storeId !== targetStoreMapping.storeId) {
            return false;
        }
        if (options?.startDate && inv.TxnDate < options.startDate) return false;
        if (options?.endDate && inv.TxnDate > options.endDate) return false;
        return true;
    });

    // 2. Fetch existing Bills for Warehouse Vendor (116)
    const billsData: any = await new Promise((resolve, reject) => {
        qbo.findBills(`WHERE VendorRef = '${WAREHOUSE_VENDOR_ID}' ORDERBY TxnDate DESC MAXRESULTS 200`, (err: any, data: any) => {
            if (err) reject(err);
            else resolve(data);
        });
    });

    const qbBills = billsData?.QueryResponse?.Bill || [];
    
    // Index bills by DocNumber
    const billsByDocNumber: Record<string, any> = {};
    for (const b of qbBills) {
        if (b.DocNumber) {
            billsByDocNumber[b.DocNumber.trim()] = b;
        }
    }

    // 3. Assemble unified records
    const results: WarehouseInvoiceRecord[] = filteredInvoices.map((inv: any) => {
        const custId = inv.CustomerRef?.value;
        const custName = inv.CustomerRef?.name || '';
        const mapping = findMappingByCustomer(custId, custName);

        const docNumber = inv.DocNumber ? inv.DocNumber.trim() : '';
        const matchingBill = docNumber ? billsByDocNumber[docNumber] : null;

        return {
            invoiceId: inv.Id,
            docNumber,
            txnDate: inv.TxnDate,
            dueDate: inv.DueDate,
            shipDate: inv.ShipDate,
            totalAmount: Number(inv.TotalAmt) || 0,
            balance: Number(inv.Balance) || 0,
            customerId: custId,
            customerName: custName,
            storeId: mapping?.storeId,
            storeName: mapping?.storeName || custName,
            departmentId: mapping?.qbDepartmentId,
            departmentName: mapping?.qbDepartmentName,
            classId: mapping?.qbClassId,
            className: mapping?.qbClassName,
            hasBill: !!matchingBill,
            bill: matchingBill ? {
                billId: matchingBill.Id,
                docNumber: matchingBill.DocNumber,
                txnDate: matchingBill.TxnDate,
                dueDate: matchingBill.DueDate,
                totalAmount: Number(matchingBill.TotalAmt) || 0,
                createdAt: matchingBill.MetaData?.CreateTime,
                vendorName: matchingBill.VendorRef?.name || WAREHOUSE_VENDOR_NAME,
                departmentName: matchingBill.DepartmentRef?.name
            } : undefined
        };
    });

    return results;
}

/**
 * Creates a QuickBooks Bill for a specific Invoice DocNumber.
 */
export async function createQuickBooksBillForInvoice(
    invoiceDocNumber: string,
    options?: {
        billDate?: string;
        dueDate?: string;
        customAmount?: number;
    }
): Promise<{ success: boolean; bill?: any; error?: string }> {
    const qbo = await getQuickBooksClient();
    const cleanDoc = invoiceDocNumber.trim();

    // 1. Check if bill already exists for this DocNumber and Vendor 116
    const existingBills: any = await new Promise((resolve) => {
        qbo.findBills(`WHERE VendorRef = '${WAREHOUSE_VENDOR_ID}' AND DocNumber = '${cleanDoc}'`, (err: any, data: any) => {
            resolve(data?.QueryResponse?.Bill || []);
        });
    });

    if (existingBills.length > 0) {
        return {
            success: false,
            error: `El Bill #${cleanDoc} ya existe en QuickBooks (ID: ${existingBills[0].Id})`,
            bill: existingBills[0]
        };
    }

    // 2. Fetch the invoice to get exact details (Amount, Store Customer, TxnDate)
    const invoicesData: any = await new Promise((resolve, reject) => {
        qbo.findInvoices({ DocNumber: cleanDoc }, (err: any, data: any) => {
            if (err) reject(err);
            else resolve(data);
        });
    });

    const invoice = invoicesData?.QueryResponse?.Invoice?.[0];
    if (!invoice) {
        return {
            success: false,
            error: `No se encontró el Invoice #${cleanDoc} en QuickBooks`
        };
    }

    // 3. Resolve Store Mapping
    const mapping = findMappingByCustomer(invoice.CustomerRef?.value, invoice.CustomerRef?.name);
    if (!mapping) {
        return {
            success: false,
            error: `No se pudo determinar la tienda para el cliente "${invoice.CustomerRef?.name}" (ID: ${invoice.CustomerRef?.value})`
        };
    }

    // 4. Prepare dates and amount
    const billDate = options?.billDate || invoice.TxnDate;
    const dueDate = options?.dueDate || addDaysToDateString(billDate, 30);
    const amount = options?.customAmount !== undefined ? options.customAmount : Number(invoice.TotalAmt);

    // 5. Construct the exact Bill payload
    const billPayload: any = {
        DocNumber: cleanDoc,
        TxnDate: billDate,
        DueDate: dueDate,
        SalesTermRef: {
            value: SALES_TERM_ID
        },
        DepartmentRef: {
            value: mapping.qbDepartmentId,
            name: mapping.qbDepartmentName
        },
        CurrencyRef: {
            value: 'USD',
            name: 'United States Dollar'
        },
        VendorRef: {
            value: WAREHOUSE_VENDOR_ID,
            name: WAREHOUSE_VENDOR_NAME
        },
        APAccountRef: {
            value: AP_ACCOUNT_ID,
            name: 'Accounts Payable'
        },
        TotalAmt: amount,
        Line: [
            {
                Amount: amount,
                DetailType: 'AccountBasedExpenseLineDetail',
                AccountBasedExpenseLineDetail: {
                    ClassRef: {
                        value: mapping.qbClassId,
                        name: mapping.qbClassName
                    },
                    AccountRef: {
                        value: COGS_ACCOUNT_ID,
                        name: COGS_ACCOUNT_NAME
                    },
                    BillableStatus: 'NotBillable',
                    TaxCodeRef: {
                        value: 'NON'
                    }
                }
            }
        ]
    };

    // 6. Post to QuickBooks API
    try {
        const createdBill: any = await new Promise((resolve, reject) => {
            qbo.createBill(billPayload, (err: any, data: any) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        return {
            success: true,
            bill: createdBill
        };
    } catch (err: any) {
        console.error('Error creating bill in QuickBooks:', err);
        const faultMsg = err?.fault?.error?.[0]?.detail || err?.fault?.error?.[0]?.message || err?.message || JSON.stringify(err);
        return {
            success: false,
            error: `Error de QuickBooks: ${faultMsg}`
        };
    }
}

/**
 * @module QuickBooksBillsTypes
 * @description Tipos, interfaces y catálogos estáticos compartidos para el módulo Crear Bills (QuickBooks Online),
 *              incluyendo tanto las facturas de La Bodega (Warehouse) como las facturas semanales de Viele & Sons
 *              (Sodas, Restaurant Supplies y Químicos Imperial Chemical) sincronizadas desde Wholesail.
 *
 * @businessRules
 * - La Bodega (Warehouse): VendorRef = '116' ("Tacos El Gavilan - Warehouse"), Terms = Net 30 (ID '10'), Cuenta = 50010 Prep Foods (ID '71').
 * - Viele & Sons (Wholesail): VendorRef = '1' ("Viele & Sons"), Terms = Net 60 (ID '4', DueDate = TxnDate + 60 días).
 * - Clasificación contable Viele & Sons:
 *   1) Facturas de Sodas (BIB 5 Gal) -> 100% a '50001 COGS Purchases:Beverages' (ID '103').
 *   2) Facturas de Químicos (50xxxxx / PO CHEMICAL / Imperial Chemical) -> 100% a '51170 Janitorial Supplies' (ID '79').
 *   3) Facturas de Insumos Generales (Wxxxxxx) -> '53050 Restaurant Supplies' (ID '22'), pero si incluyen Cloro ('3BLEA'),
 *      se divide automáticamente en 2 líneas: el monto de '3BLEA' ($12.01) a '51170 Janitorial Supplies' (ID '79')
 *      y el resto (Total - 3BLEA) a '53050 Restaurant Supplies' (ID '22').
 * - El DocNumber en QBO para Viele & Sons omite el sufijo '-IN' / '-CM' de Wholesail (ej. 'W150396-IN' -> 'W150396').
 *
 * @dataFlow
 * - Importado por Client Components ('app/admin/crear-bills/page.tsx') y librerías/endpoints del servidor
 *   ('lib/quickbooks-bills.ts', 'lib/viele-wholesail-bills.ts', 'app/api/quickbooks/bills/route.ts', 'app/api/quickbooks/viele-bills/route.ts').
 *
 * @notes
 * - Seguro para importar tanto en Client Components ('use client') como en Server Components y API routes.
 */

export interface StoreQBMappings {
    storeId: string;
    storeName: string;
    qbCustomerId: string;
    qbCustomerName: string;
    qbDepartmentId: string; // Location in QBO UI
    qbDepartmentName: string;
    qbClassId: string; // Class in QBO UI
    qbClassName: string;
}

export const WAREHOUSE_VENDOR_ID = '116';
export const WAREHOUSE_VENDOR_NAME = 'Tacos El Gavilan - Warehouse';
export const COGS_ACCOUNT_ID = '71';
export const COGS_ACCOUNT_NAME = '50010 COGS Purchases:Prep Foods';
export const SALES_TERM_ID = '10'; // "15" term in QBO (Net 30)
export const AP_ACCOUNT_ID = '54';

// Canonical mapping of all 15 stores to their QBO Customer, Location (Department), and Class
export const STORE_QB_MAPPINGS: Record<string, StoreQBMappings> = {
    '1100': {
        storeId: '4',
        storeName: 'Azusa',
        qbCustomerId: '1100',
        qbCustomerName: 'Azusa-TEG',
        qbDepartmentId: '12',
        qbDepartmentName: 'Azusa',
        qbClassId: '2200000000000075341',
        qbClassName: 'Azusa'
    },
    '1101': {
        storeId: '13',
        storeName: 'Bell',
        qbCustomerId: '1101',
        qbCustomerName: 'Bell-TEG',
        qbDepartmentId: '10',
        qbDepartmentName: 'Bell',
        qbClassId: '2700000000000006003',
        qbClassName: 'Bell'
    },
    '1104': {
        storeId: '16',
        storeName: 'Downey',
        qbCustomerId: '1104',
        qbCustomerName: 'Downey-TEG',
        qbDepartmentId: '5',
        qbDepartmentName: 'Downey',
        qbClassId: '5',
        qbClassName: 'Downey'
    },
    '1111': {
        storeId: '8',
        storeName: 'Hollywood',
        qbCustomerId: '1111',
        qbCustomerName: 'Hollywood-TEG',
        qbDepartmentId: '14',
        qbDepartmentName: 'Hollywood',
        qbClassId: '2200000000000083328',
        qbClassName: 'Hollywood'
    },
    '1105': {
        storeId: '11',
        storeName: 'Huntington Park',
        qbCustomerId: '1105',
        qbCustomerName: 'Huntington Park-TEG',
        qbDepartmentId: '2',
        qbDepartmentName: 'Huntington Park',
        qbClassId: '1',
        qbClassName: 'Huntington Park'
    },
    '1102': {
        storeId: '5',
        storeName: 'LA Broadway',
        qbCustomerId: '1102',
        qbCustomerName: 'Broadway-TEG',
        qbDepartmentId: '3',
        qbDepartmentName: 'Broadway LA',
        qbClassId: '4',
        qbClassName: 'Broadway LA'
    },
    '1103': {
        storeId: '6',
        storeName: 'LA Central',
        qbCustomerId: '1103',
        qbCustomerName: 'Central-TEG',
        qbDepartmentId: '4',
        qbDepartmentName: 'Central LA',
        qbClassId: '3',
        qbClassName: 'Central LA'
    },
    '1110': {
        storeId: '10',
        storeName: 'La Puente',
        qbCustomerId: '1110',
        qbCustomerName: 'La Puente-TEG',
        qbDepartmentId: '19',
        qbDepartmentName: 'La Puente',
        qbClassId: '2200000000000140845',
        qbClassName: 'La Puente'
    },
    '1108': {
        storeId: '14',
        storeName: 'Lynwood',
        qbCustomerId: '1108',
        qbCustomerName: 'Lynwood-TEG',
        qbDepartmentId: '13',
        qbDepartmentName: 'Lynwood',
        qbClassId: '2200000000000075312',
        qbClassName: 'Lynwood'
    },
    '1219': {
        storeId: '12',
        storeName: 'Norwalk',
        qbCustomerId: '1219',
        qbCustomerName: 'Norwalk-TEG',
        qbDepartmentId: '24',
        qbDepartmentName: 'Norwalk',
        qbClassId: '2200000000000222249',
        qbClassName: 'Norwalk'
    },
    '1441': {
        storeId: '1',
        storeName: 'Rialto',
        qbCustomerId: '1441',
        qbCustomerName: 'Rialto-TEG',
        qbDepartmentId: '11',
        qbDepartmentName: 'Rialto',
        qbClassId: '2200000000000057575',
        qbClassName: 'Rialto'
    },
    '1106': {
        storeId: '9',
        storeName: 'Santa Ana',
        qbCustomerId: '1106',
        qbCustomerName: 'Santa Ana-TEG',
        qbDepartmentId: '18',
        qbDepartmentName: 'Santa Ana',
        qbClassId: '2200000000000136142',
        qbClassName: 'Santa Ana'
    },
    '1329': {
        storeId: '7',
        storeName: 'Slauson',
        qbCustomerId: '1329',
        qbCustomerName: 'Slauson-TEG',
        qbDepartmentId: '20',
        qbDepartmentName: 'Slauson',
        qbClassId: '2200000000000164243',
        qbClassName: 'Slauson'
    },
    '1109': {
        storeId: '15',
        storeName: 'South Gate',
        qbCustomerId: '1109',
        qbCustomerName: 'South Gate-TEG',
        qbDepartmentId: '16',
        qbDepartmentName: 'South Gate',
        qbClassId: '2200000000000140757',
        qbClassName: 'South Gate'
    },
    '1107': {
        storeId: '3',
        storeName: 'West Covina',
        qbCustomerId: '1107',
        qbCustomerName: 'West Covina-TEG',
        qbDepartmentId: '17',
        qbDepartmentName: 'West Covina',
        qbClassId: '2200000000000134063',
        qbClassName: 'West Covina'
    }
};

// Helper lookup by storeId
export const STORE_QB_MAPPINGS_BY_STORE_ID: Record<string, StoreQBMappings> = Object.values(STORE_QB_MAPPINGS).reduce(
    (acc, item) => {
        acc[item.storeId] = item;
        return acc;
    },
    {} as Record<string, StoreQBMappings>
);

// Helper lookup by customerId or customerName (bidirectional, case-insensitive)
export function findMappingByCustomer(customerRefId?: string, customerRefName?: string): StoreQBMappings | null {
    if (customerRefId && STORE_QB_MAPPINGS[customerRefId]) {
        return STORE_QB_MAPPINGS[customerRefId];
    }
    if (customerRefName && typeof customerRefName === 'string') {
        const nameLower = customerRefName.toLowerCase().trim();
        for (const mapping of Object.values(STORE_QB_MAPPINGS)) {
            const storeLower = mapping.storeName.toLowerCase();
            const qbCustLower = mapping.qbCustomerName.toLowerCase();
            if (
                nameLower === qbCustLower ||
                nameLower.includes(storeLower) ||
                storeLower.includes(nameLower) ||
                nameLower.replace(/[-_ ]teg$/i, '') === storeLower
            ) {
                return mapping;
            }
        }
    }
    return null;
}

export interface WarehouseInvoiceRecord {
    invoiceId: string;
    docNumber: string;
    txnDate: string;
    dueDate: string;
    shipDate?: string;
    totalAmount: number;
    balance: number;
    customerId: string;
    customerName: string;
    storeId?: string;
    storeName: string;
    departmentId?: string;
    departmentName?: string;
    classId?: string;
    className?: string;
    hasBill: boolean;
    bill?: {
        billId: string;
        docNumber: string;
        txnDate: string;
        dueDate: string;
        totalAmount: number;
        createdAt?: string;
        vendorName: string;
        departmentName?: string;
    };
}

// ============================================================================
// VIELE & SONS (WHOLESAIL -> QUICKBOOKS ONLINE) CONSTANTS & TYPES
// ============================================================================

export const VIELE_VENDOR_ID = '1';
export const VIELE_VENDOR_NAME = 'Viele & Sons';
export const VIELE_SALES_TERM_ID = '4'; // Net 60 in QBO
export const VIELE_DUE_DAYS = 60;
export const WHOLESAIL_VIELE_SELLER_ID = 'a4068b0b-dc2e-4676-84b6-4b3740c73b3b';

/**
 * Catálogo canónico de los 15 Buyer Company UUIDs de Tacos Gavilan en Wholesail (app.paywholesail.com)
 */
export const WHOLESAIL_STORE_BUYER_IDS: Record<number, { storeId: number; storeName: string; buyerId: string; wholesailUrl: string }> = {
    1: {
        storeId: 1,
        storeName: 'Rialto',
        buyerId: '23343739-eb32-5f30-b6dd-3185e55445b8',
        wholesailUrl: 'https://app.paywholesail.com/companies/23343739-eb32-5f30-b6dd-3185e55445b8/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    3: {
        storeId: 3,
        storeName: 'West Covina',
        buyerId: '17ea5d1f-c5a5-5587-92fa-3cbc503489ca',
        wholesailUrl: 'https://app.paywholesail.com/companies/17ea5d1f-c5a5-5587-92fa-3cbc503489ca/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    4: {
        storeId: 4,
        storeName: 'Azusa',
        buyerId: 'ad44a402-a2a1-53c2-93f8-e5b662a89e97',
        wholesailUrl: 'https://app.paywholesail.com/companies/ad44a402-a2a1-53c2-93f8-e5b662a89e97/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    5: {
        storeId: 5,
        storeName: 'LA Broadway',
        buyerId: '961d726f-b56e-53e9-93fd-b257478175db',
        wholesailUrl: 'https://app.paywholesail.com/companies/961d726f-b56e-53e9-93fd-b257478175db/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    6: {
        storeId: 6,
        storeName: 'LA Central',
        buyerId: '62fea11f-b4ed-5b0c-a8d8-598109d3f335',
        wholesailUrl: 'https://app.paywholesail.com/companies/62fea11f-b4ed-5b0c-a8d8-598109d3f335/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    7: {
        storeId: 7,
        storeName: 'Slauson',
        buyerId: 'e0dea026-17b7-50b4-9b4f-c528ad82cd25',
        wholesailUrl: 'https://app.paywholesail.com/companies/e0dea026-17b7-50b4-9b4f-c528ad82cd25/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    8: {
        storeId: 8,
        storeName: 'Hollywood',
        buyerId: '19875298-4756-557c-83d2-9e196779e36e',
        wholesailUrl: 'https://app.paywholesail.com/companies/19875298-4756-557c-83d2-9e196779e36e/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    9: {
        storeId: 9,
        storeName: 'Santa Ana',
        buyerId: 'bef65958-5ed2-53a0-aa59-cd8b003d08d1',
        wholesailUrl: 'https://app.paywholesail.com/companies/bef65958-5ed2-53a0-aa59-cd8b003d08d1/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    10: {
        storeId: 10,
        storeName: 'La Puente',
        buyerId: '962b4b4e-9115-5e8a-a893-2e5331747cf5',
        wholesailUrl: 'https://app.paywholesail.com/companies/962b4b4e-9115-5e8a-a893-2e5331747cf5/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    11: {
        storeId: 11,
        storeName: 'Huntington Park',
        buyerId: '8183bbf0-332d-5ccf-8627-98b0de6debf3',
        wholesailUrl: 'https://app.paywholesail.com/companies/8183bbf0-332d-5ccf-8627-98b0de6debf3/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    12: {
        storeId: 12,
        storeName: 'Norwalk',
        buyerId: '1b82c4c3-c20b-5fd5-b319-64bbc506ff66',
        wholesailUrl: 'https://app.paywholesail.com/companies/1b82c4c3-c20b-5fd5-b319-64bbc506ff66/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    13: {
        storeId: 13,
        storeName: 'Bell',
        buyerId: 'b89fdb44-f779-5036-9980-2f1cc2b8c914',
        wholesailUrl: 'https://app.paywholesail.com/companies/b89fdb44-f779-5036-9980-2f1cc2b8c914/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    14: {
        storeId: 14,
        storeName: 'Lynwood',
        buyerId: '894011f5-b451-5dd9-b8c5-d194784f1996',
        wholesailUrl: 'https://app.paywholesail.com/companies/894011f5-b451-5dd9-b8c5-d194784f1996/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    15: {
        storeId: 15,
        storeName: 'South Gate',
        buyerId: 'd15078d8-66b7-523a-88a9-4ab785ec5ba2',
        wholesailUrl: 'https://app.paywholesail.com/companies/d15078d8-66b7-523a-88a9-4ab785ec5ba2/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    },
    16: {
        storeId: 16,
        storeName: 'Downey',
        buyerId: '8614b264-8afa-5633-ba13-feec22243269',
        wholesailUrl: 'https://app.paywholesail.com/companies/8614b264-8afa-5633-ba13-feec22243269/vendors/a4068b0b-dc2e-4676-84b6-4b3740c73b3b?utm_source=BUYER_STATEMENT&utm_medium=email'
    }
};

export const WHOLESAIL_BUYER_ID_TO_STORE_ID: Record<string, number> = Object.values(WHOLESAIL_STORE_BUYER_IDS).reduce(
    (acc, item) => {
        acc[item.buyerId.toLowerCase()] = item.storeId;
        return acc;
    },
    {} as Record<string, number>
);

export const VIELE_GL_ACCOUNTS = {
    BEVERAGES: {
        id: '103',
        name: '50001 COGS Purchases:Beverages',
        shortLabel: '50001 Beverages'
    },
    RESTAURANT_SUPPLIES: {
        id: '22',
        name: '53050 Restaurant Supplies',
        shortLabel: '53050 Restaurant Supplies'
    },
    JANITORIAL_SUPPLIES: {
        id: '79',
        name: '51170 Janitorial Supplies',
        shortLabel: '51170 Janitorial Supplies'
    }
} as const;

export type VieleInvoiceCategory = 'SODAS' | 'SUPPLIES' | 'SUPPLIES_SPLIT' | 'CHEMICALS';

export interface VieleExpenseLineSplit {
    accountId: string;
    accountName: string;
    amount: number;
    description?: string;
}

export interface VieleProductLineItem {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    isSoda: boolean;
    isChemical: boolean;
    isBleach: boolean;
}

export interface VieleWholesailInvoiceRecord {
    wholesailUuid: string;
    documentId: string; // Raw from Wholesail e.g. "W150396-IN"
    docNumber: string; // Normalized for QBO e.g. "W150396"
    poNumber: string;
    txnDate: string; // YYYY-MM-DD
    dueDate: string; // YYYY-MM-DD (txnDate + 60 days for QBO Net 60)
    wholesailDueDate?: string; // Original due date shown in Wholesail (Net 30)
    subtotalAmount: number;
    taxAmount: number;
    totalAmount: number;
    outstandingAmount: number;
    wholesailStatus: string; // "UNPAID" | "PAID" | "PARTIAL"
    overdue: boolean;
    source: 'WHOLESAIL' | 'CLEARNINE';
    storeId: string;
    storeName: string;
    sageCustomerCode: string;
    departmentId: string;
    departmentName: string;
    classId: string;
    className: string;
    category: VieleInvoiceCategory;
    expenseSplits: VieleExpenseLineSplit[];
    lineItems: VieleProductLineItem[];
    hasBill: boolean;
    bill?: {
        billId: string;
        docNumber: string;
        txnDate: string;
        dueDate: string;
        totalAmount: number;
        balance?: number;
        createdAt?: string;
        vendorName: string;
        departmentName?: string;
        lines?: VieleExpenseLineSplit[];
    };
}

export interface WholesailStoreConnectionStatus {
    storeId: number;
    storeName: string;
    sageCustomerCode: string;
    connected: boolean;
    buyerId?: string;
    tokenType?: string;
    expiresAt?: string;
}


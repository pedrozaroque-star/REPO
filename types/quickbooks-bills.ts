/**
 * @module QuickBooksBillsTypes
 * @description Tipos, interfaces y catálogos estáticos compartidos para el módulo Crear Bills (QuickBooks Online).
 * Seguro para importar tanto en Client Components ('use client') como en Server Components y API routes.
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

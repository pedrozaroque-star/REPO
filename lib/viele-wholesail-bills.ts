/**
 * @module VieleWholesailBillsLib
 * @description Librería backend para sincronizar las 3 facturas semanales de Viele & Sons por sucursal
 *              desde el portal Wholesail (app.paywholesail.com) hacia QuickBooks Online (QBO) como Bills
 *              por pagar (Vendor ID '1': "Viele & Sons").
 *
 * @businessRules
 * 1. Cada sucursal de Tacos Gavilan recibe 3 facturas por semana de Viele & Sons:
 *    - Factura 1 (Wxxxxxx): Sodas (BIB 5 Gal) -> Cuenta QBO '50001 COGS Purchases:Beverages' (ID: '103').
 *    - Factura 2 (Wxxxxxx): Insumos / Papel / Desechables -> Cuenta QBO '53050 Restaurant Supplies' (ID: '22').
 *      * Regla Especial de Cloro ('3BLEA'): Si la factura general incluye el artículo '3BLEA' (Bleach 3/1 Gal),
 *        el Bill se divide automáticamente en 2 líneas:
 *        a) Monto de '3BLEA' (ej. $12.01) -> '51170 Janitorial Supplies' (ID: '79').
 *        b) Resto de la factura (Total - 3BLEA) -> '53050 Restaurant Supplies' (ID: '22').
 *    - Factura 3 (50xxxxx / 499xxxx / PO CHEMICAL): Químicos (Imperial Chemical) -> Cuenta QBO '51170 Janitorial Supplies' (ID: '79').
 * 2. Términos y Fechas en QBO:
 *    - VendorRef: { value: '1', name: 'Viele & Sons' }
 *    - APAccountRef: { value: '54', name: 'Accounts Payable' }
 *    - SalesTermRef: { value: '4' } (Net 60)
 *    - TxnDate: Fecha de la factura (YYYY-MM-DD)
 *    - DueDate: TxnDate + 60 días calendario (Net 60)
 *    - DocNumber: Número de factura sin el sufijo '-IN' o '-CM' (ej. 'W150396-IN' -> 'W150396', '5031164-IN' -> '5031164')
 * 3. Prevención de Duplicados:
 *    - Antes de insertar cualquier Bill en QBO, se verifica que no exista un Bill con VendorRef='1' y el mismo DocNumber.
 *
 * @dataFlow
 * - Lee y persiste tokens de Wholesail en la tabla `integrations` de Supabase (`service_name = 'wholesail_viele'`).
 * - Consulta `POST https://app.paywholesail.com/api/v1/company/invoicePage` para obtener las facturas y sus líneas (`detail.lines`).
 * - Cruza contra los Bills existentes en QBO (`VendorRef = '1'`) usando `getQuickBooksClient()`.
 * - Crea Bills individuales o en lote en QBO asignando `DepartmentRef` (Location) y `ClassRef` (Class) de la sucursal.
 *
 * @notes
 * - [2026-10-22] Validado contra 65 facturas históricas de LA Broadway en QBO con 100% de exactitud en cuentas GL y centavos.
 */

import { getQuickBooksClient } from '@/lib/quickbooks';
import { supabaseAdmin } from '@/lib/supabase';
import { isVieleSoda, isVieleChemical } from '@/lib/viele-catalog-data';
import { VIELE_PUBLIC_STORES } from '@/lib/viele-stores-public';
import {
    AP_ACCOUNT_ID,
    STORE_QB_MAPPINGS,
    STORE_QB_MAPPINGS_BY_STORE_ID,
    StoreQBMappings,
    VIELE_DUE_DAYS,
    VIELE_GL_ACCOUNTS,
    VIELE_SALES_TERM_ID,
    VIELE_VENDOR_ID,
    VIELE_VENDOR_NAME,
    VieleExpenseLineSplit,
    VieleInvoiceCategory,
    VieleProductLineItem,
    VieleWholesailInvoiceRecord,
    WHOLESAIL_BUYER_ID_TO_STORE_ID,
    WHOLESAIL_STORE_BUYER_IDS,
    WHOLESAIL_VIELE_SELLER_ID,
    WholesailStoreConnectionStatus
} from '@/types/quickbooks-bills';

const WHOLESAIL_API_BASE = 'https://app.paywholesail.com/api/v1';
const WHOLESAIL_SERVICE_NAME = 'wholesail_viele';
const CLEARNINE_BASE = 'https://shop.vieleandsons.com';

/**
 * Mapa completo de facturas 50xxxxx (PO: CHEMICAL / órdenes manuales Imperial Chemical)
 * emitidas en Septiembre y Octubre 2026 para las 15 sucursales de Tacos Gavilan.
 */
export const KNOWN_SEP_OCT_50X_BY_STORE: Record<number, string[]> = {
    1: ['5025141', '5026777', '5028109', '5029590', '5031167', '5032663', '5034151', '5035640'],
    3: ['5031161', '5032662', '5034154', '5035642'],
    4: ['5025174', '5025175', '5026816', '5026817', '5028119', '5028120', '5029633', '5029634', '5031156', '5032658', '5034180'],
    5: ['5026768', '5028112', '5029584', '5031164', '5031595', '5032664', '5034113', '5035637'],
    6: ['5025171', '5026813', '5028107', '5029626', '5031160', '5032667', '5034155', '5035708'],
    7: ['5025178', '5026818', '5028108', '5029628', '5031157', '5032656', '5034179', '5035726'],
    8: ['5025177', '5026824', '5028461', '5029627', '5031162', '5032657', '5034153', '5035641'],
    9: ['5025176', '5026814', '5026815', '5028116', '5029630', '5029631', '5031154', '5032661', '5034159', '5035723'],
    10: ['5031155', '5032666', '5034156', '5035643'],
    11: ['5025170', '5026812', '5028117', '5029629', '5031159', '5032660', '5034157', '5035721'],
    12: ['5025139', '5025140', '5026775', '5026776', '5028103', '5028104', '5029591', '5029592', '5031165', '5032669', '5032670', '5034144', '5035636'],
    13: ['5025172', '5026810', '5028105', '5029521', '5031166', '5032659', '5034178', '5035553'],
    14: ['5025142', '5026769', '5028455', '5029632', '5031058', '5032671', '5034158', '5035724'],
    15: ['5025290', '5026893', '5028337', '5029751', '5031318', '5032831', '5033957', '5034360', '5035788'],
    16: ['5025173', '5026767', '5028458', '5029568', '5031163', '5032665', '5034149', '5035638']
};

/**
 * Token semilla de 2 años para LA Broadway (#5 - EL GAVILAN #2 BRDWY, CustomerID: ELG4 / 00ELG4)
 * provisto en el enlace oficial de Buyer Statement de Wholesail.
 */
const DEFAULT_BROADWAY_WHOLESAIL_CONNECTION = {
    storeId: 5,
    buyerId: '961d726f-b56e-53e9-93fd-b257478175db',
    token: 'eyJraWQiOiIxIiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiJBQjcvR1BOdFMxS2NwS213Z0c5OWdRPT0iLCJpYXQiOjE3OTI2NzIyNzIsImV4cCI6MTg1NTc0NDI3MiwicCI6IlIiLCJnIjp7Imc5QWxkbGZ0RWZHeW4wSUJDaHpnTFE9PSI6WyJSIl0sImxoMXliN1Z1VSttVC9iSlhSNEYxMnc9PSI6WyJMIl0sInBBYUxDOXd1Um5hRXRrczNRTWM3T3c9PSI6WyJSIl0sIm9vd3lhbndrV2RLVWhFTTJTZjJnMHc9PSI6WyJSIl19LCJ1IjoiYTI4YzMyNmEtN2MyNC01OWQyLTk0ODQtNDMzNjQ5ZmRhMGQzIn0.hTkDyEbkwOBwwzl_HnBFWVl0cUcfFXdMYthacKXHCtGVRcaQtXOtD1F6R2waQznRZYCRqIW4giSBK_jevkz57_aguFT1qvKFL6cOLMc5mfY5V2QJWyad2kLnA_qKEtpg07G0RWku91o48qFcxJ9v_SX4lf455wQVNAgROlULGRGzOp2QiAOgo_i8jKfAZO9gp-SzFL5VoYaMNlbjhULFr4D2FbPSJ56FBc5iFd7QQZpyzMYg1IwDIWwA4MdcoLKsstRQRkd-b-nd9JTfexi0L976UstzceY930hkiGOi4d3_brM2S2IX-0eTFZ2j4f75-3ZqZ09dECRaPtZUcU6wEQ',
    tokenType: 'RESTRICTED',
    expiresAt: '2028-10-21T12:31:12.000Z'
};

export interface StoredWholesailConnection {
    storeId: number;
    buyerId: string;
    token: string;
    tokenType: string;
    expiresAt: string;
}

/**
 * Normaliza el número de documento de Wholesail eliminando el sufijo '-IN' o '-CM'
 * (Ej: 'W150396-IN' -> 'W150396', '5031164-IN' -> '5031164').
 */
export function normalizeVieleDocNumber(rawDocId: string | null | undefined): string {
    if (!rawDocId) return '';
    return String(rawDocId)
        .trim()
        .replace(/-(IN|CM|DM)$/i, '')
        .trim();
}

/**
 * Suma días calendario en UTC a una fecha YYYY-MM-DD sin desajustes por horario de verano (DST).
 */
export function addDaysToDateString(dateStr: string, days: number): string {
    const clean = String(dateStr || '').trim().split('T')[0];
    const parts = clean.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
    }
    const [year, month, day] = parts;
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    d.setUTCDate(d.getUTCDate() + days);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Decodifica el payload de un JWT de Wholesail para extraer su fecha de expiración (`exp`) y tipo (`p`).
 */
export function decodeWholesailJwtMeta(token: string): { expiresAt: string; tokenType: string } {
    try {
        const parts = token.split('.');
        if (parts.length >= 2) {
            const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
            const payload = JSON.parse(payloadJson);
            const expMs = payload.exp ? Number(payload.exp) * 1000 : Date.now() + 365 * 86400 * 1000;
            const tokenType = payload.p === 'U' ? 'UNRESTRICTED' : 'RESTRICTED';
            return {
                expiresAt: new Date(expMs).toISOString(),
                tokenType
            };
        }
    } catch {
        // Fallback default 1 year
    }
    return {
        expiresAt: new Date(Date.now() + 365 * 86400 * 1000).toISOString(),
        tokenType: 'RESTRICTED'
    };
}

/**
 * Extrae el token `_wsrt` de una URL completa de Wholesail o devuelve el token limpio si se pegó directamente.
 */
export function extractWholesailTokenFromInput(input: string): { token: string; urlBuyerId?: string } {
    const trimmed = String(input || '').trim();
    if (!trimmed) {
        throw new Error('El enlace o token de Wholesail está vacío.');
    }

    let urlBuyerId: string | undefined;
    const companyMatch = trimmed.match(/\/companies\/([0-9a-fA-F-]{36})/i);
    if (companyMatch?.[1]) {
        urlBuyerId = companyMatch[1].toLowerCase();
    }

    if (trimmed.includes('_wsrt=')) {
        try {
            const url = new URL(trimmed);
            const wsrt = url.searchParams.get('_wsrt');
            if (wsrt) {
                return { token: wsrt.trim(), urlBuyerId };
            }
        } catch {
            const match = trimmed.match(/[?&]_wsrt=([^&#\s]+)/i);
            if (match?.[1]) {
                return { token: decodeURIComponent(match[1].trim()), urlBuyerId };
            }
        }
    }

    // Check if raw JWT
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(trimmed)) {
        return { token: trimmed, urlBuyerId };
    }

    throw new Error('No se encontró un token válido (_wsrt) en el enlace proporcionado. Asegúrate de copiar el enlace completo desde el correo de Wholesail.');
}

/**
 * Empareja el `buyerId` UUID, el `customerId` de Wholesail (ej. "ELG4", "ELGA10", "ELG") o el nombre de la tienda
 * contra el catálogo oficial de 15 sucursales (`VIELE_PUBLIC_STORES` y `WHOLESAIL_BUYER_ID_TO_STORE_ID`).
 */
export function matchWholesailCompanyToStoreId(customerId?: string, companyName?: string, buyerId?: string): number | null {
    if (buyerId) {
        const byUuid = WHOLESAIL_BUYER_ID_TO_STORE_ID[String(buyerId).trim().toLowerCase()];
        if (byUuid) return byUuid;
    }

    if (customerId) {
        const cleanCust = String(customerId).trim().toUpperCase().replace(/^00/, '');
        for (const store of Object.values(VIELE_PUBLIC_STORES)) {
            const cleanSage = store.sageCustomerCode.trim().toUpperCase().replace(/^00/, '');
            if (cleanCust === cleanSage) {
                return store.storeId;
            }
        }
    }

    if (companyName) {
        const nameUpper = companyName.toUpperCase();
        if (nameUpper.includes('BRDWY') || nameUpper.includes('BROADWAY')) return 5;
        if (nameUpper.includes('RIALTO')) return 1;
        if (nameUpper.includes('COVINA')) return 3;
        if (nameUpper.includes('AZUSA')) return 4;
        if (nameUpper.includes('CENTRAL') || nameUpper.includes('#1 LOS ANGELES')) return 6;
        if (nameUpper.includes('SLAUSON')) return 7;
        if (nameUpper.includes('HOLLYWOOD') || nameUpper.includes('HLLYWD') || nameUpper.includes('SUNSET')) return 8;
        if (nameUpper.includes('SANTA ANA') || nameUpper.includes('STA ANA')) return 9;
        if (nameUpper.includes('PUENTE')) return 10;
        if (nameUpper.includes('HUNTINGTON') || nameUpper.includes('HP')) return 11;
        if (nameUpper.includes('NORWALK')) return 12;
        if (nameUpper.includes('BELL')) return 13;
        if (nameUpper.includes('LYNWOOD')) return 14;
        if (nameUpper.includes('SOUTH GATE') || nameUpper.includes('SOUTHGATE')) return 15;
        if (nameUpper.includes('DOWNEY')) return 16;
    }

    return null;
}

/**
 * Obtiene todas las conexiones de Wholesail almacenadas en Supabase (`integrations`),
 * sembrando automáticamente la conexión por defecto de LA Broadway (#5) si aún no existe.
 */
export async function getWholesailStoreConnections(): Promise<{
    connectionsByStoreId: Map<number, StoredWholesailConnection>;
    cachedInvoicesByStoreId: Map<number, VieleWholesailInvoiceRecord[]>;
    storeStatuses: WholesailStoreConnectionStatus[];
}> {
    const connectionsByStoreId = new Map<number, StoredWholesailConnection>();
    const cachedInvoicesByStoreId = new Map<number, VieleWholesailInvoiceRecord[]>();

    // Always seed default Broadway connection in memory first
    connectionsByStoreId.set(DEFAULT_BROADWAY_WHOLESAIL_CONNECTION.storeId, {
        ...DEFAULT_BROADWAY_WHOLESAIL_CONNECTION
    });

    try {
        const { data: rows, error } = await supabaseAdmin
            .from('integrations')
            .select('*')
            .in('service_name', [WHOLESAIL_SERVICE_NAME, 'viele_store_invoices_cache']);

        if (!error && Array.isArray(rows)) {
            let hasBroadwayInDb = false;
            for (const row of rows) {
                if (row.service_name === WHOLESAIL_SERVICE_NAME && row.access_token) {
                    const rawToken = String(row.access_token).trim();
                    if (rawToken.startsWith('{')) {
                        try {
                            const mapObj = JSON.parse(rawToken);
                            for (const [k, val] of Object.entries(mapObj)) {
                                const sid = Number(k);
                                const v = val as any;
                                if (!isNaN(sid) && sid > 0 && v?.token && v?.buyerId) {
                                    if (sid === 5) hasBroadwayInDb = true;
                                    connectionsByStoreId.set(sid, {
                                        storeId: sid,
                                        buyerId: String(v.buyerId),
                                        token: String(v.token),
                                        tokenType: String(v.tokenType || 'RESTRICTED'),
                                        expiresAt: v.expiresAt || DEFAULT_BROADWAY_WHOLESAIL_CONNECTION.expiresAt
                                    });
                                }
                            }
                        } catch {
                            // Ignore malformed JSON
                        }
                    } else {
                        const storeId = Number(row.realm_id);
                        if (!isNaN(storeId) && storeId > 0 && row.refresh_token) {
                            if (storeId === 5) hasBroadwayInDb = true;
                            connectionsByStoreId.set(storeId, {
                                storeId,
                                buyerId: String(row.refresh_token).trim(),
                                token: rawToken,
                                tokenType: String(row.token_type || 'RESTRICTED'),
                                expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : DEFAULT_BROADWAY_WHOLESAIL_CONNECTION.expiresAt
                            });
                        }
                    }
                } else if (row.service_name === 'viele_store_invoices_cache' && row.access_token) {
                    try {
                        const parsed = JSON.parse(String(row.access_token));
                        if (Array.isArray(parsed)) {
                            const sid = Number(row.realm_id);
                            if (!isNaN(sid) && sid > 0) {
                                cachedInvoicesByStoreId.set(sid, parsed);
                            }
                        } else if (parsed && typeof parsed === 'object') {
                            for (const [k, arr] of Object.entries(parsed)) {
                                const sid = Number(k);
                                if (!isNaN(sid) && sid > 0 && Array.isArray(arr)) {
                                    cachedInvoicesByStoreId.set(sid, arr as VieleWholesailInvoiceRecord[]);
                                }
                            }
                        }
                    } catch {
                        // Ignore malformed cache JSON
                    }
                }
            }

            if (!hasBroadwayInDb) {
                await supabaseAdmin.from('integrations').insert({
                    service_name: WHOLESAIL_SERVICE_NAME,
                    realm_id: String(DEFAULT_BROADWAY_WHOLESAIL_CONNECTION.storeId),
                    access_token: DEFAULT_BROADWAY_WHOLESAIL_CONNECTION.token,
                    refresh_token: DEFAULT_BROADWAY_WHOLESAIL_CONNECTION.buyerId,
                    token_type: DEFAULT_BROADWAY_WHOLESAIL_CONNECTION.tokenType,
                    expires_at: DEFAULT_BROADWAY_WHOLESAIL_CONNECTION.expiresAt,
                    updated_at: new Date().toISOString()
                });
            }
        }
    } catch (e) {
        console.warn('[VieleWholesail] Warning reading integrations table:', e);
    }

    const storeStatuses: WholesailStoreConnectionStatus[] = Object.values(VIELE_PUBLIC_STORES)
        .sort((a, b) => a.storeName.localeCompare(b.storeName))
        .map((store) => {
            const conn = connectionsByStoreId.get(store.storeId);
            const hasCache = cachedInvoicesByStoreId.has(store.storeId);
            const isExpired = conn?.expiresAt ? new Date(conn.expiresAt) <= new Date() : false;
            return {
                storeId: store.storeId,
                storeName: store.storeName,
                sageCustomerCode: store.sageCustomerCode,
                connected: Boolean((conn && !isExpired) || hasCache),
                buyerId: conn?.buyerId || WHOLESAIL_STORE_BUYER_IDS[store.storeId]?.buyerId,
                tokenType: conn?.tokenType || (hasCache ? 'CLEARNINE_SYNC' : undefined),
                expiresAt: conn?.expiresAt
            };
        });

    return { connectionsByStoreId, cachedInvoicesByStoreId, storeStatuses };
}

/**
 * Registra un enlace o token de Wholesail consultando `/api/v1/company/available`
 * y vinculando automáticamente todas las sucursales de Tacos Gavilan que vengan autorizadas en ese token.
 */
export async function registerWholesailLinkOrToken(
    inputUrlOrToken: string,
    explicitStoreId?: number
): Promise<{
    connectedStores: Array<{ storeId: number; storeName: string; buyerId: string; customerId?: string }>;
}> {
    const { token, urlBuyerId } = extractWholesailTokenFromInput(inputUrlOrToken);
    const { expiresAt, tokenType } = decodeWholesailJwtMeta(token);

    const res = await fetch(`${WHOLESAIL_API_BASE}/company/available`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `ws ${token}`
        },
        body: JSON.stringify({})
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Wholesail rechazó el token (HTTP ${res.status}): ${errText || 'Token inválido o expirado'}`);
    }

    const data = await res.json();
    const companiesObj = data?.companies || {};
    const connectedStores: Array<{ storeId: number; storeName: string; buyerId: string; customerId?: string }> = [];

    const { connectionsByStoreId } = await getWholesailStoreConnections();

    for (const [compId, compVal] of Object.entries(companiesObj)) {
        const comp = compVal as any;
        if (!comp || compId === WHOLESAIL_VIELE_SELLER_ID) continue;

        let matchedStoreId = matchWholesailCompanyToStoreId(comp.customerId, comp.name, compId);
        if (!matchedStoreId && explicitStoreId && urlBuyerId && compId.toLowerCase() === urlBuyerId) {
            matchedStoreId = explicitStoreId;
        }

        if (matchedStoreId && VIELE_PUBLIC_STORES[matchedStoreId]) {
            const storeInfo = VIELE_PUBLIC_STORES[matchedStoreId];
            connectedStores.push({
                storeId: matchedStoreId,
                storeName: storeInfo.storeName,
                buyerId: compId,
                customerId: comp.customerId
            });

            connectionsByStoreId.set(matchedStoreId, {
                storeId: matchedStoreId,
                buyerId: compId,
                token,
                tokenType,
                expiresAt
            });
        }
    }

    if (connectedStores.length === 0) {
        throw new Error('El token de Wholesail es válido pero no se pudo asociar a ninguna sucursal de Tacos Gavilan.');
    }

    // Persist map of all connected stores in the single WHOLESAIL_SERVICE_NAME row
    const serializedMap: Record<string, StoredWholesailConnection> = {};
    for (const [sid, conn] of connectionsByStoreId.entries()) {
        serializedMap[String(sid)] = conn;
    }

    const { data: existing } = await supabaseAdmin
        .from('integrations')
        .select('id')
        .eq('service_name', WHOLESAIL_SERVICE_NAME)
        .maybeSingle();

    if (existing?.id) {
        await supabaseAdmin
            .from('integrations')
            .update({
                realm_id: 'all_wholesail_stores',
                access_token: JSON.stringify(serializedMap),
                refresh_token: 'MULTI_STORE_MAP',
                token_type: tokenType,
                expires_at: expiresAt,
                updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
    } else {
        await supabaseAdmin.from('integrations').insert({
            service_name: WHOLESAIL_SERVICE_NAME,
            realm_id: 'all_wholesail_stores',
            access_token: JSON.stringify(serializedMap),
            refresh_token: 'MULTI_STORE_MAP',
            token_type: tokenType,
            expires_at: expiresAt,
            updated_at: new Date().toISOString()
        });
    }

    return { connectedStores };
}

/**
 * Solicita a Wholesail el envío de un código de verificación de 6 dígitos al correo corporativo (ej. ap@tacosgavilan.com).
 */
export async function requestWholesailPasscode(emailAddress = 'ap@tacosgavilan.com'): Promise<{ emailAddress: string }> {
    const cleanEmail = String(emailAddress || 'ap@tacosgavilan.com').trim().toLowerCase();
    const res = await fetch(`${WHOLESAIL_API_BASE}/user/passcode/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            emailAddress: cleanEmail,
            platform: 'WEB'
        })
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Error al solicitar código a Wholesail (HTTP ${res.status}): ${text}`);
    }

    return { emailAddress: cleanEmail };
}

/**
 * Verifica el código de 6 dígitos enviado por Wholesail y vincula automáticamente todas las sucursales autorizadas.
 */
export async function verifyWholesailPasscode(
    code: string,
    emailAddress = 'ap@tacosgavilan.com'
): Promise<{
    connectedStores: Array<{ storeId: number; storeName: string; buyerId: string; customerId?: string }>;
}> {
    const cleanEmail = String(emailAddress || 'ap@tacosgavilan.com').trim().toLowerCase();
    const cleanCode = String(code || '').trim();
    if (!cleanCode) {
        throw new Error('Ingresa el código de verificación enviado por correo.');
    }

    const res = await fetch(`${WHOLESAIL_API_BASE}/user/login/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            emailAddress: cleanEmail,
            password: cleanCode,
            platform: 'WEB'
        })
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Código de verificación inválido o expirado (HTTP ${res.status}): ${text}`);
    }

    const data = await res.json();
    const token =
        data?.token ||
        data?.accessToken ||
        data?.jwt ||
        (typeof data?.result === 'string' ? data.result : data?.result?.token);

    if (!token || typeof token !== 'string') {
        throw new Error('Wholesail no devolvió un token de sesión válido.');
    }

    return registerWholesailLinkOrToken(token);
}

/**
 * Clasifica una factura de Viele & Sons según sus artículos (`lineItems`) y su `poNumber`,
 * calculando la partición exacta de líneas contables para QuickBooks Online (incluyendo el split de Cloro `3BLEA`).
 */
export function classifyVieleInvoiceLines(params: {
    totalAmount: number;
    poNumber?: string | null;
    lineItems: VieleProductLineItem[];
}): {
    category: VieleInvoiceCategory;
    expenseSplits: VieleExpenseLineSplit[];
} {
    const totalAmount = Number(Number(params.totalAmount || 0).toFixed(2));
    const poUpper = String(params.poNumber || '').trim().toUpperCase();
    const activeLines = (params.lineItems || []).filter((l) => Number(l.totalAmount || 0) > 0);
    // Excluir renglones de cargos administrativos/combustible (ej. '/FUEL') al evaluar si todos los artículos son Sodas o Químicos
    const productLines = activeLines.filter((l) => !String(l.productId || '').trim().startsWith('/'));

    // 1. ¿Todas las líneas de producto positivas son Sodas (BIB 5 Gal)? -> 50001 COGS Purchases:Beverages (ID: '103')
    const allSodas = productLines.length > 0 && productLines.every((l) => l.isSoda);
    if (allSodas) {
        return {
            category: 'SODAS',
            expenseSplits: [
                {
                    accountId: VIELE_GL_ACCOUNTS.BEVERAGES.id,
                    accountName: VIELE_GL_ACCOUNTS.BEVERAGES.name,
                    amount: totalAmount
                }
            ]
        };
    }

    // 2. ¿Es una factura de Químicos (PO contiene CHEM / CHEMICAL o todas las líneas de producto son químicos)? -> 51170 Janitorial Supplies (ID: '79')
    const allChemicals = productLines.length > 0 && productLines.every((l) => l.isChemical);
    if (poUpper.includes('CHEM') || allChemicals) {
        return {
            category: 'CHEMICALS',
            expenseSplits: [
                {
                    accountId: VIELE_GL_ACCOUNTS.JANITORIAL_SUPPLIES.id,
                    accountName: VIELE_GL_ACCOUNTS.JANITORIAL_SUPPLIES.name,
                    amount: totalAmount
                }
            ]
        };
    }

    // 3. Factura de Insumos Generales (Wxxxxxx): revisar si contiene Cloro ('3BLEA')
    const bleachAmountRaw = activeLines
        .filter((l) => l.isBleach)
        .reduce((sum, l) => sum + Number(l.totalAmount || 0), 0);
    const bleachAmount = Number(bleachAmountRaw.toFixed(2));

    if (bleachAmount > 0 && bleachAmount < totalAmount) {
        const suppliesAmount = Number((totalAmount - bleachAmount).toFixed(2));
        return {
            category: 'SUPPLIES_SPLIT',
            expenseSplits: [
                {
                    accountId: VIELE_GL_ACCOUNTS.RESTAURANT_SUPPLIES.id,
                    accountName: VIELE_GL_ACCOUNTS.RESTAURANT_SUPPLIES.name,
                    amount: suppliesAmount
                },
                {
                    accountId: VIELE_GL_ACCOUNTS.JANITORIAL_SUPPLIES.id,
                    accountName: VIELE_GL_ACCOUNTS.JANITORIAL_SUPPLIES.name,
                    amount: bleachAmount
                }
            ]
        };
    }

    return {
        category: 'SUPPLIES',
        expenseSplits: [
            {
                accountId: VIELE_GL_ACCOUNTS.RESTAURANT_SUPPLIES.id,
                accountName: VIELE_GL_ACCOUNTS.RESTAURANT_SUPPLIES.name,
                amount: totalAmount
            }
        ]
    };
}

/**
 * Descarga las facturas de una sucursal desde Wholesail API (`POST /api/v1/company/invoicePage`).
 */
async function fetchStoreInvoicesFromWholesail(
    conn: StoredWholesailConnection,
    startDate?: string,
    endDate?: string
): Promise<VieleWholesailInvoiceRecord[]> {
    const storeInfo = VIELE_PUBLIC_STORES[conn.storeId];
    const qbMapping: StoreQBMappings | undefined = STORE_QB_MAPPINGS_BY_STORE_ID[String(conn.storeId)];
    if (!storeInfo || !qbMapping) return [];

    const allRawInvoices: any[] = [];
    let offset = 0;
    const limit = 100;

    while (offset < 300) {
        const res = await fetch(`${WHOLESAIL_API_BASE}/company/invoicePage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `ws ${conn.token}`
            },
            body: JSON.stringify({
                offset,
                limit,
                sortBy: 'INVOICE_EPOCH_DESC',
                sellerIds: [WHOLESAIL_VIELE_SELLER_ID],
                buyerIds: [conn.buyerId],
                type: ['INVOICE', 'CREDIT', 'PROFORMA']
            })
        });

        if (!res.ok) {
            console.warn(`[VieleWholesail] Error fetching store ${conn.storeId} from Wholesail: HTTP ${res.status}`);
            break;
        }

        const data = await res.json();
        const resultIds: string[] = Array.isArray(data?.result) ? data.result : [];
        const invoicesMap = data?.invoices || {};

        if (resultIds.length === 0) break;

        let oldestEpochInPage = '9999-99-99';
        for (const uuid of resultIds) {
            const inv = invoicesMap[uuid];
            if (inv) {
                allRawInvoices.push(inv);
                if (inv.invoiceEpoch && inv.invoiceEpoch < oldestEpochInPage) {
                    oldestEpochInPage = inv.invoiceEpoch;
                }
            }
        }

        if (resultIds.length < limit) break;
        if (startDate && oldestEpochInPage < startDate) break;
        offset += limit;
    }

    const records: VieleWholesailInvoiceRecord[] = [];

    for (const inv of allRawInvoices) {
        const totalCents = Number(inv.totalCents || 0);
        // Ignorar facturas en $0.00 (ej. órdenes canceladas o ajustes internos sin saldo)
        if (totalCents <= 0) continue;

        const txnDate = String(inv.invoiceEpoch || '').trim();
        if (!txnDate) continue;
        if (startDate && txnDate < startDate) continue;
        if (endDate && txnDate > endDate) continue;

        const documentId = String(inv.documentId || '').trim();
        const docNumber = normalizeVieleDocNumber(documentId);
        if (!docNumber) continue;

        const poNumber = String(inv.poNumber || '').trim();
        const subtotalAmount = Number((Number(inv.subtotalCents || 0) / 100).toFixed(2));
        const taxAmount = Number((Number(inv.taxCents || 0) / 100).toFixed(2));
        const totalAmount = Number((totalCents / 100).toFixed(2));
        const outstandingAmount = Number((Number(inv.outstandingCents || 0) / 100).toFixed(2));
        const dueDate = addDaysToDateString(txnDate, VIELE_DUE_DAYS);

        const rawLines: any[] = Array.isArray(inv.detail?.lines) ? inv.detail.lines : [];
        const lineItems: VieleProductLineItem[] = rawLines
            .filter((l) => Number(l.totalCents || 0) !== 0 || Number(l.quantity || 0) !== 0)
            .map((l) => {
                const productId = String(l.productId || '').trim();
                const productUpper = productId.toUpperCase();
                return {
                    productId,
                    productName: String(l.productName || '').trim(),
                    quantity: Number(l.quantity || 0),
                    unitPrice: Number((Number(l.unitPriceCents || 0) / 100).toFixed(2)),
                    totalAmount: Number((Number(l.totalCents || 0) / 100).toFixed(2)),
                    isSoda: isVieleSoda(productUpper),
                    isChemical: isVieleChemical(productUpper),
                    isBleach: productUpper === '3BLEA'
                };
            });

        const { category, expenseSplits } = classifyVieleInvoiceLines({
            totalAmount,
            poNumber,
            lineItems
        });

        records.push({
            wholesailUuid: String(inv.id || docNumber),
            documentId,
            docNumber,
            poNumber,
            txnDate,
            dueDate,
            wholesailDueDate: inv.due ? String(inv.due) : undefined,
            subtotalAmount,
            taxAmount,
            totalAmount,
            outstandingAmount,
            wholesailStatus: String(inv.status || 'UNPAID'),
            overdue: Boolean(inv.overdue),
            source: 'WHOLESAIL',
            storeId: qbMapping.storeId,
            storeName: qbMapping.storeName,
            sageCustomerCode: storeInfo.sageCustomerCode,
            departmentId: qbMapping.qbDepartmentId,
            departmentName: qbMapping.qbDepartmentName,
            classId: qbMapping.qbClassId,
            className: qbMapping.qbClassName,
            category,
            expenseSplits,
            lineItems,
            hasBill: false
        });
    }

    return records;
}

function cleanClearNineHtml(val: any): string {
    if (!val) return '';
    return String(val).replace(/<[^>]+>/g, '').trim();
}

function parseClearNineMoney(val: any): number {
    const c = cleanClearNineHtml(val).replace(/[$,\s]/g, '');
    const n = Number(c);
    return isNaN(n) ? 0 : n;
}

function mmddyyyyToIso(dateStr: string): string {
    const clean = cleanClearNineHtml(dateStr);
    const parts = clean.split('/');
    if (parts.length === 3) {
        const [m, d, y] = parts;
        const year = y.length === 2 ? `20${y}` : y;
        return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return clean;
}

async function loginClearNineStore(email: string, password: string): Promise<{ success: boolean; cookieHeader: string }> {
    const params = new URLSearchParams();
    params.append('UserID', email);
    params.append('Password', password);
    params.append('RememberMe', 'RememberMe');
    params.append('submit', 'User Login');

    const res = await fetch(`${CLEARNINE_BASE}/login/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Origin: CLEARNINE_BASE,
            Referer: `${CLEARNINE_BASE}/login/`
        },
        body: params.toString(),
        redirect: 'manual'
    });

    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
    return { success: res.status === 302 || res.status === 200, cookieHeader };
}

/**
 * Sincroniza directamente las 15 sucursales desde el portal de Viele & Sons (ClearNine) y Wholesail,
 * incluyendo tanto las facturas Wxxxxxx (Sodas e Insumos) como las facturas 50xxxxx (PO: CHEMICAL),
 * reutilizando detalles en caché para facturas históricas ya descargadas y descubriendo automáticamente
 * nuevas facturas 50xxxxx semanales. Actualiza `viele_store_invoices_cache` en Supabase (`integrations`).
 */
export async function syncAllVieleStoresFromClearNine(
    minDate = '2026-07-01',
    targetStoreId?: number,
    forceFullResync = false
): Promise<Record<string, VieleWholesailInvoiceRecord[]>> {
    const rawSecrets = process.env.VIELE_STORE_ACCOUNTS_JSON;
    if (!rawSecrets) {
        throw new Error('VIELE_STORE_ACCOUNTS_JSON no está configurado en el servidor.');
    }
    const secrets: Record<string, { email: string; password: string }> = JSON.parse(rawSecrets);

    // 1. Leer conexiones de Wholesail y caché actual
    const { connectionsByStoreId, cachedInvoicesByStoreId } = await getWholesailStoreConnections();
    const allStoresCache: Record<string, VieleWholesailInvoiceRecord[]> = {};
    for (const [sid, list] of cachedInvoicesByStoreId.entries()) {
        allStoresCache[String(sid)] = list;
    }

    const storeIds = targetStoreId
        ? [targetStoreId]
        : Object.keys(VIELE_PUBLIC_STORES).map(Number);

    // 2. Consultar en paralelo las facturas vivas de Wholesail para las tiendas conectadas
    const wholesailByStore = new Map<number, VieleWholesailInvoiceRecord[]>();
    const new50xAnchors: Array<{ docNum: number; txnDate: string }> = [];

    await Promise.all(
        storeIds.map(async (sid) => {
            const conn = connectionsByStoreId.get(sid);
            if (!conn) return;
            try {
                const wsList = await fetchStoreInvoicesFromWholesail(conn, minDate);
                wholesailByStore.set(sid, wsList);
                for (const rec of wsList) {
                    if (/^50\d{5}$/.test(rec.docNumber) && rec.txnDate > '2026-10-21') {
                        const num = Number(rec.docNumber);
                        if (!isNaN(num)) {
                            new50xAnchors.push({ docNum: num, txnDate: rec.txnDate });
                        }
                    }
                }
            } catch (err) {
                console.warn(`[VieleSync] Warning fetching Wholesail for store ${sid}:`, err);
            }
        })
    );

    // 3. Sincronizar las 15 tiendas en lotes paralelos de 5 con ClearNine + fusionar con Wholesail y caché existente
    const storeBatchSize = 5;
    for (let sIdx = 0; sIdx < storeIds.length; sIdx += storeBatchSize) {
        const storeChunk = storeIds.slice(sIdx, sIdx + storeBatchSize);
        await Promise.all(
            storeChunk.map(async (storeId) => {
                const storeInfo = VIELE_PUBLIC_STORES[storeId];
                const acc = secrets[String(storeId)];
                const qbMapping = STORE_QB_MAPPINGS_BY_STORE_ID[String(storeId)];
                if (!storeInfo || !acc || !qbMapping) return;

                const existingList = cachedInvoicesByStoreId.get(storeId) || [];
                const existingByDoc = new Map<string, VieleWholesailInvoiceRecord>();
                for (const oldRec of existingList) {
                    if (oldRec?.docNumber) {
                        existingByDoc.set(oldRec.docNumber, oldRec);
                    }
                }

                const invoiceTargets = new Map<string, string>();

                // Preservar todos los docNumbers ya conocidos en caché (>= minDate)
                for (const [docNo, oldRec] of existingByDoc.entries()) {
                    if (!oldRec.txnDate || oldRec.txnDate >= minDate) {
                        invoiceTargets.set(docNo, oldRec.txnDate || '');
                    }
                }

                // Agregar facturas 50xxxxx históricas conocidas de Septiembre y Octubre
                const known50x = KNOWN_SEP_OCT_50X_BY_STORE[storeId] || [];
                for (const inv50 of known50x) {
                    if (!invoiceTargets.has(inv50)) {
                        invoiceTargets.set(inv50, '');
                    }
                }

                const login = await loginClearNineStore(acc.email, acc.password).catch(() => ({
                    success: false,
                    cookieHeader: ''
                }));
                if (login.cookieHeader) {
                    // Obtener historial de órdenes web (Wxxxxxx) desde salesOrderList_dt
                    const histRes = await fetch(
                        `${CLEARNINE_BASE}/api/salesOrderList_dt?sEcho=1&iDisplayStart=0&iDisplayLength=1000&iSortCol_0=0&sSortDir_0=desc`,
                        { headers: { Cookie: login.cookieHeader } }
                    ).catch(() => null);
                    const histData = histRes ? await histRes.json().catch(() => ({ aaData: [] })) : { aaData: [] };
                    const rows: any[] = histData?.aaData || [];

                    for (const r of rows) {
                        const invNo = cleanClearNineHtml(r[0]);
                        const orderDateIso = mmddyyyyToIso(r[1]);
                        if (!invNo || orderDateIso < minDate) continue;
                        invoiceTargets.set(invNo, orderDateIso);
                    }

                    // Si hay nuevas facturas 50xxxxx en Wholesail (> 2026-10-21) y esta tienda no tiene Wholesail conectado,
                    // explorar ventana cercana de 50xxxxx en ClearNine si aún no tiene factura química para esa semana
                    if (!connectionsByStoreId.has(storeId) && new50xAnchors.length > 0) {
                        const existing50xDates = Array.from(existingByDoc.values())
                            .filter((r) => /^50\d{5}$/.test(r.docNumber))
                            .map((r) => r.txnDate);

                        const candidateNums = new Set<string>();
                        for (const anchor of new50xAnchors) {
                            const hasNearDate = existing50xDates.some(
                                (d) =>
                                    Math.abs(new Date(d).getTime() - new Date(anchor.txnDate).getTime()) <=
                                    5 * 86400 * 1000
                            );
                            if (!hasNearDate) {
                                for (let n = anchor.docNum - 15; n <= anchor.docNum + 70; n++) {
                                    candidateNums.add(String(n));
                                }
                            }
                        }
                        for (const cand of candidateNums) {
                            if (!invoiceTargets.has(cand)) {
                                invoiceTargets.set(cand, '');
                            }
                        }
                    }
                }

                const storeRecordsMap = new Map<string, VieleWholesailInvoiceRecord>();
                const toFetchFromClearNine: Array<[string, string]> = [];

                for (const [invNo, fallbackDate] of invoiceTargets.entries()) {
                    const cached = existingByDoc.get(invNo);
                    if (
                        !forceFullResync &&
                        cached &&
                        Array.isArray(cached.lineItems) &&
                        cached.lineItems.length > 0 &&
                        cached.totalAmount > 0 &&
                        cached.txnDate >= minDate
                    ) {
                        const { category, expenseSplits } = classifyVieleInvoiceLines({
                            totalAmount: cached.totalAmount,
                            poNumber: cached.poNumber,
                            lineItems: cached.lineItems
                        });
                        storeRecordsMap.set(invNo, {
                            ...cached,
                            category,
                            expenseSplits
                        });
                    } else if (login.cookieHeader) {
                        toFetchFromClearNine.push([invNo, fallbackDate]);
                    }
                }

                const batchSize = 8;
                for (let i = 0; i < toFetchFromClearNine.length; i += batchSize) {
                    const batch = toFetchFromClearNine.slice(i, i + batchSize);
                    const batchResults = await Promise.all(
                        batch.map(async ([invNo, fallbackDate]) => {
                            try {
                                const [docRes, detRes] = await Promise.all([
                                    fetch(`${CLEARNINE_BASE}/api/invoice_doc?invoiceNo=${invNo}&headerSeqNo=000000`, {
                                        headers: { Cookie: login.cookieHeader }
                                    }),
                                    fetch(
                                        `${CLEARNINE_BASE}/api/invoiceDetail_dt?invoiceNo=${invNo}&headerSeqNo=000000&sEcho=1&iDisplayStart=0&iDisplayLength=200`,
                                        { headers: { Cookie: login.cookieHeader } }
                                    )
                                ]);

                                const docData = await docRes.json().catch(() => null);
                                const detData = await detRes.json().catch(() => null);
                                const header = docData?.header;
                                if (!header || !header.InvoiceNo) return null;

                                const txnDate = header.InvoiceDate
                                    ? mmddyyyyToIso(header.InvoiceDate)
                                    : fallbackDate;
                                if (!txnDate || txnDate < minDate) return null;

                                const subtotalAmount = parseClearNineMoney(
                                    header.NetInvoice ||
                                        Number(header.TaxableSalesAmt || 0) + Number(header.NonTaxableSalesAmt || 0)
                                );
                                const taxAmount = parseClearNineMoney(header.SalesTaxAmt);
                                const totalAmount =
                                    parseClearNineMoney(header.InvoiceTotal) ||
                                    Number((subtotalAmount + taxAmount).toFixed(2));
                                if (!totalAmount || isNaN(totalAmount) || totalAmount <= 0) return null;

                                const poNumber = String(header.CustomerPONo || '').trim();
                                const dueDate = addDaysToDateString(txnDate, VIELE_DUE_DAYS);

                                const rawLines: any[] = detData?.aaData || [];
                                const lineItems: VieleProductLineItem[] = rawLines
                                    .map((lr: any) => {
                                        const productId = cleanClearNineHtml(lr[9] || lr[0]);
                                        const productUpper = productId.toUpperCase();
                                        const productName = cleanClearNineHtml(lr[1]);
                                        const quantity = Number(cleanClearNineHtml(lr[2])) || 0;
                                        const unitPrice = parseClearNineMoney(lr[4]);
                                        const lineTotal = parseClearNineMoney(lr[5]);
                                        return {
                                            productId,
                                            productName,
                                            quantity,
                                            unitPrice,
                                            totalAmount: lineTotal,
                                            isSoda: isVieleSoda(productUpper),
                                            isChemical: isVieleChemical(productUpper),
                                            isBleach: productUpper === '3BLEA'
                                        };
                                    })
                                    .filter((li) => li.totalAmount > 0 || li.quantity > 0);

                                const { category, expenseSplits } = classifyVieleInvoiceLines({
                                    totalAmount,
                                    poNumber,
                                    lineItems
                                });

                                const rec: VieleWholesailInvoiceRecord = {
                                    wholesailUuid: `clearnine_${storeId}_${invNo}`,
                                    documentId: `${invNo}-IN`,
                                    docNumber: invNo,
                                    poNumber,
                                    txnDate,
                                    dueDate,
                                    subtotalAmount: Number(subtotalAmount.toFixed(2)),
                                    taxAmount: Number(taxAmount.toFixed(2)),
                                    totalAmount,
                                    outstandingAmount: totalAmount,
                                    wholesailStatus: 'UNPAID',
                                    overdue: false,
                                    source: 'WHOLESAIL',
                                    storeId: qbMapping.storeId,
                                    storeName: qbMapping.storeName,
                                    sageCustomerCode: storeInfo.sageCustomerCode,
                                    departmentId: qbMapping.qbDepartmentId,
                                    departmentName: qbMapping.qbDepartmentName,
                                    classId: qbMapping.qbClassId,
                                    className: qbMapping.qbClassName,
                                    category,
                                    expenseSplits,
                                    lineItems,
                                    hasBill: false
                                };
                                return rec;
                            } catch {
                                return null;
                            }
                        })
                    );

                    for (const r of batchResults) {
                        if (r) storeRecordsMap.set(r.docNumber, r);
                    }
                }

                // Fusionar con las facturas vivas de Wholesail (actualizando estado PAID/UNPAID y agregando nuevas facturas)
                const wsRecords = wholesailByStore.get(storeId) || [];
                for (const wsRec of wsRecords) {
                    storeRecordsMap.set(wsRec.docNumber, wsRec);
                }

                const mergedList = Array.from(storeRecordsMap.values()).sort((a, b) => {
                    const cmp = b.txnDate.localeCompare(a.txnDate);
                    if (cmp !== 0) return cmp;
                    return b.docNumber.localeCompare(a.docNumber);
                });

                allStoresCache[String(storeId)] = mergedList;
            })
        );
    }

    const { data: existing } = await supabaseAdmin
        .from('integrations')
        .select('id')
        .eq('service_name', 'viele_store_invoices_cache')
        .maybeSingle();

    if (existing?.id) {
        await supabaseAdmin
            .from('integrations')
            .update({
                realm_id: 'all_15_stores',
                access_token: JSON.stringify(allStoresCache),
                refresh_token: 'CLEARNINE_BATCH_SYNC',
                token_type: 'CLEARNINE_SYNC',
                updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
    } else {
        await supabaseAdmin.from('integrations').insert({
            service_name: 'viele_store_invoices_cache',
            realm_id: 'all_15_stores',
            access_token: JSON.stringify(allStoresCache),
            refresh_token: 'CLEARNINE_BATCH_SYNC',
            token_type: 'CLEARNINE_SYNC',
            updated_at: new Date().toISOString()
        });
    }

    return allStoresCache;
}

/**
 * Consulta todos los Bills de Viele & Sons (`VendorRef = '1'`) en QuickBooks Online.
 */
export async function fetchExistingVieleQuickBooksBills(qbo: any, startDate?: string): Promise<any[]> {
    const criteria: any[] = [
        { field: 'VendorRef', value: VIELE_VENDOR_ID, operator: '=' },
        { field: 'limit', value: 1000 }
    ];
    if (startDate) {
        // Restar 15 días de margen por si la fecha del Bill varía ligeramente
        const safeStart = addDaysToDateString(startDate, -15);
        criteria.push({ field: 'TxnDate', value: safeStart, operator: '>=' });
    }

    return new Promise<any[]>((resolve, reject) => {
        qbo.findBills(criteria, (err: any, data: any) => {
            if (err) return reject(err);
            resolve(data?.QueryResponse?.Bill || []);
        });
    });
}

/**
 * Obtiene las facturas de Viele & Sons desde Wholesail y las cruza contra los Bills existentes en QuickBooks Online.
 */
export async function fetchVieleWholesailInvoicesWithBillStatus(filters?: {
    startDate?: string;
    endDate?: string;
    storeId?: string;
    status?: 'all' | 'pending' | 'created';
    category?: 'all' | VieleInvoiceCategory;
    refresh?: boolean;
}): Promise<{
    records: VieleWholesailInvoiceRecord[];
    storeStatuses: WholesailStoreConnectionStatus[];
}> {
    if (filters?.refresh) {
        try {
            const targetSid =
                filters?.storeId && filters.storeId !== 'all' ? Number(filters.storeId) : undefined;
            await syncAllVieleStoresFromClearNine(filters?.startDate || '2026-07-01', targetSid);
        } catch (err) {
            console.warn('[VieleWholesail] Warning during live ClearNine refresh:', err);
        }
    }

    const { connectionsByStoreId, cachedInvoicesByStoreId, storeStatuses } = await getWholesailStoreConnections();

    // Determinar qué tiendas conectadas consultar en Wholesail
    const targetConnections: StoredWholesailConnection[] = [];
    if (filters?.storeId && filters.storeId !== 'all') {
        const sid = Number(filters.storeId);
        const conn = connectionsByStoreId.get(sid);
        if (conn) targetConnections.push(conn);
    } else {
        for (const conn of connectionsByStoreId.values()) {
            targetConnections.push(conn);
        }
    }

    // Combinar facturas sincronizadas de las 15 tiendas (cachedInvoicesByStoreId) + facturas vivas de Wholesail
    const cachedArrays: VieleWholesailInvoiceRecord[][] = [];
    for (const [sid, cachedList] of cachedInvoicesByStoreId.entries()) {
        if (filters?.storeId && filters.storeId !== 'all' && String(sid) !== filters.storeId) continue;
        const filteredCached = cachedList
            .filter((r) => {
                if (filters?.startDate && r.txnDate < filters.startDate) return false;
                if (filters?.endDate && r.txnDate > filters.endDate) return false;
                return true;
            })
            .map((r) => {
                const reclass =
                    Array.isArray(r.lineItems) && r.lineItems.length > 0
                        ? classifyVieleInvoiceLines({
                              totalAmount: r.totalAmount,
                              poNumber: r.poNumber,
                              lineItems: r.lineItems
                          })
                        : { category: r.category, expenseSplits: r.expenseSplits };
                return {
                    ...r,
                    category: reclass.category,
                    expenseSplits: reclass.expenseSplits,
                    hasBill: false,
                    bill: undefined
                };
            });
        cachedArrays.push(filteredCached);
    }

    // Ejecutar en paralelo la consulta a Wholesail y la consulta a QuickBooks Online
    const [wholesailArrays, qbo] = await Promise.all([
        Promise.all(
            targetConnections.map((conn) =>
                fetchStoreInvoicesFromWholesail(conn, filters?.startDate, filters?.endDate)
            )
        ),
        getQuickBooksClient()
    ]);

    const qbBills = await fetchExistingVieleQuickBooksBills(qbo, filters?.startDate);

    // Indexar Bills de QBO por DocNumber normalizado
    const billsByDocNumber = new Map<string, any>();
    for (const bill of qbBills) {
        if (bill.DocNumber) {
            const norm = normalizeVieleDocNumber(String(bill.DocNumber));
            billsByDocNumber.set(norm, bill);
            billsByDocNumber.set(String(bill.DocNumber).trim(), bill);
        }
    }

    const recordsMap = new Map<string, VieleWholesailInvoiceRecord>();
    const matchedDocNumbers = new Set<string>();

    const allSourceArrays = [...cachedArrays, ...wholesailArrays];
    for (const arr of allSourceArrays) {
        for (const rec of arr) {
            const matchedBill = billsByDocNumber.get(rec.docNumber) || billsByDocNumber.get(rec.documentId);
            if (matchedBill) {
                matchedDocNumbers.add(rec.docNumber);
                const qbLines: VieleExpenseLineSplit[] = (matchedBill.Line || [])
                    .filter((l: any) => l.DetailType === 'AccountBasedExpenseLineDetail')
                    .map((l: any) => ({
                        accountId: String(l.AccountBasedExpenseLineDetail?.AccountRef?.value || ''),
                        accountName: String(l.AccountBasedExpenseLineDetail?.AccountRef?.name || ''),
                        amount: Number(Number(l.Amount || 0).toFixed(2)),
                        description: l.Description ? String(l.Description) : undefined
                    }));

                rec.hasBill = true;
                rec.bill = {
                    billId: String(matchedBill.Id),
                    docNumber: String(matchedBill.DocNumber || rec.docNumber),
                    txnDate: String(matchedBill.TxnDate || rec.txnDate),
                    dueDate: String(matchedBill.DueDate || rec.dueDate),
                    totalAmount: Number(matchedBill.TotalAmt || 0),
                    balance: Number(matchedBill.Balance ?? 0),
                    createdAt: matchedBill.MetaData?.CreateTime,
                    vendorName: matchedBill.VendorRef?.name || VIELE_VENDOR_NAME,
                    departmentName: matchedBill.DepartmentRef?.name || rec.departmentName,
                    lines: qbLines
                };
            }
            recordsMap.set(`${rec.storeId}_${rec.docNumber}`, rec);
        }
    }

    // Incluir Bills históricos ya creados en QBO (VendorRef = '1') de sucursales que aún no tengan su link de Wholesail activo
    const mappingByDeptId = new Map<string, StoreQBMappings>();
    for (const m of Object.values(STORE_QB_MAPPINGS)) {
        mappingByDeptId.set(m.qbDepartmentId, m);
    }

    for (const bill of qbBills) {
        const docNumber = normalizeVieleDocNumber(String(bill.DocNumber || ''));
        if (!docNumber || matchedDocNumbers.has(docNumber)) continue;

        const txnDate = String(bill.TxnDate || '').trim();
        if (!txnDate) continue;
        if (filters?.startDate && txnDate < filters.startDate) continue;
        if (filters?.endDate && txnDate > filters.endDate) continue;

        const deptId = String(bill.DepartmentRef?.value || '');
        const qbMapping = mappingByDeptId.get(deptId);
        if (!qbMapping) continue;

        const storeInfo = VIELE_PUBLIC_STORES[Number(qbMapping.storeId)];
        const qbLines: VieleExpenseLineSplit[] = (bill.Line || [])
            .filter((l: any) => l.DetailType === 'AccountBasedExpenseLineDetail')
            .map((l: any) => ({
                accountId: String(l.AccountBasedExpenseLineDetail?.AccountRef?.value || ''),
                accountName: String(l.AccountBasedExpenseLineDetail?.AccountRef?.name || ''),
                amount: Number(Number(l.Amount || 0).toFixed(2)),
                description: l.Description ? String(l.Description) : undefined
            }));

        const hasBeverages = qbLines.some((l) => l.accountId === VIELE_GL_ACCOUNTS.BEVERAGES.id);
        const hasSupplies = qbLines.some((l) => l.accountId === VIELE_GL_ACCOUNTS.RESTAURANT_SUPPLIES.id);
        const hasJanitorial = qbLines.some((l) => l.accountId === VIELE_GL_ACCOUNTS.JANITORIAL_SUPPLIES.id);

        let category: VieleInvoiceCategory = 'SUPPLIES';
        if (hasBeverages) category = 'SODAS';
        else if (hasSupplies && hasJanitorial) category = 'SUPPLIES_SPLIT';
        else if (hasJanitorial) category = 'CHEMICALS';

        const totalAmount = Number(Number(bill.TotalAmt || 0).toFixed(2));
        const balance = Number(Number(bill.Balance ?? 0).toFixed(2));
        const dueDate = String(bill.DueDate || addDaysToDateString(txnDate, VIELE_DUE_DAYS));

        recordsMap.set(`${qbMapping.storeId}_${docNumber}`, {
            wholesailUuid: `qbo_${bill.Id}`,
            documentId: `${docNumber}-IN`,
            docNumber,
            poNumber: category === 'CHEMICALS' ? 'CHEMICAL' : '',
            txnDate,
            dueDate,
            subtotalAmount: totalAmount,
            taxAmount: 0,
            totalAmount,
            outstandingAmount: balance,
            wholesailStatus: balance <= 0 ? 'PAID' : 'UNPAID',
            overdue: false,
            source: 'WHOLESAIL',
            storeId: qbMapping.storeId,
            storeName: qbMapping.storeName,
            sageCustomerCode: storeInfo?.sageCustomerCode || '',
            departmentId: qbMapping.qbDepartmentId,
            departmentName: qbMapping.qbDepartmentName,
            classId: qbMapping.qbClassId,
            className: qbMapping.qbClassName,
            category,
            expenseSplits: qbLines,
            lineItems: [],
            hasBill: true,
            bill: {
                billId: String(bill.Id),
                docNumber,
                txnDate,
                dueDate,
                totalAmount,
                balance,
                createdAt: bill.MetaData?.CreateTime,
                vendorName: bill.VendorRef?.name || VIELE_VENDOR_NAME,
                departmentName: bill.DepartmentRef?.name || qbMapping.qbDepartmentName,
                lines: qbLines
            }
        });
    }

    let results = Array.from(recordsMap.values());

    // Aplicar filtros adicionales
    if (filters?.storeId && filters.storeId !== 'all') {
        results = results.filter((r) => r.storeId === filters.storeId);
    }
    if (filters?.category && filters.category !== 'all') {
        results = results.filter((r) => r.category === filters.category);
    }
    if (filters?.status === 'pending') {
        results = results.filter((r) => !r.hasBill);
    } else if (filters?.status === 'created') {
        results = results.filter((r) => r.hasBill);
    }

    // Ordenar por fecha descendente y luego por número de documento descendente
    results.sort((a, b) => {
        const cmpDate = b.txnDate.localeCompare(a.txnDate);
        if (cmpDate !== 0) return cmpDate;
        return b.docNumber.localeCompare(a.docNumber);
    });

    return { records: results, storeStatuses };
}

export interface CreateVieleBillInput {
    docNumber: string;
    txnDate: string;
    totalAmount: number;
    storeId: string;
    poNumber?: string;
    expenseSplits: VieleExpenseLineSplit[];
}

export interface CreateVieleBillResult {
    docNumber: string;
    success: boolean;
    alreadyExisted?: boolean;
    billId?: string;
    txnDate?: string;
    dueDate?: string;
    totalAmount?: number;
    storeName?: string;
    departmentName?: string;
    className?: string;
    expenseSplits?: VieleExpenseLineSplit[];
    error?: string;
}

/**
 * Crea un Bill en QuickBooks Online para una factura de Viele & Sons (`VendorRef = '1'`)
 * con verificación de idempotencia anti-duplicados y soporte de líneas divididas (ej. `3BLEA`).
 */
export async function createQuickBooksBillForVieleInvoice(
    input: CreateVieleBillInput,
    qboClient?: any
): Promise<CreateVieleBillResult> {
    const qbo = qboClient || (await getQuickBooksClient());
    const docNumber = normalizeVieleDocNumber(input.docNumber);
    const txnDate = String(input.txnDate || '').trim();
    const totalAmount = Number(Number(input.totalAmount).toFixed(2));

    if (!docNumber) {
        return { docNumber: '', success: false, error: 'Missing DocNumber' };
    }
    if (!txnDate || !/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) {
        return { docNumber, success: false, error: `Invalid TxnDate: ${txnDate}` };
    }
    if (isNaN(totalAmount) || totalAmount <= 0) {
        return { docNumber, success: false, error: `Invalid TotalAmount: ${input.totalAmount}` };
    }

    const mapping = STORE_QB_MAPPINGS_BY_STORE_ID[String(input.storeId)];
    if (!mapping) {
        return {
            docNumber,
            success: false,
            error: `Could not map storeId "${input.storeId}" to a QuickBooks Location/Class.`
        };
    }

    const splits = Array.isArray(input.expenseSplits) && input.expenseSplits.length > 0
        ? input.expenseSplits
        : [
            {
                accountId: VIELE_GL_ACCOUNTS.RESTAURANT_SUPPLIES.id,
                accountName: VIELE_GL_ACCOUNTS.RESTAURANT_SUPPLIES.name,
                amount: totalAmount
            }
        ];

    const splitsSum = Number(splits.reduce((acc, s) => acc + Number(s.amount || 0), 0).toFixed(2));
    if (Math.abs(splitsSum - totalAmount) > 0.01) {
        return {
            docNumber,
            success: false,
            error: `Line split sum ($${splitsSum.toFixed(2)}) does not match invoice total ($${totalAmount.toFixed(2)}).`
        };
    }

    // 1. Verificar en QBO si ya existe un Bill con este DocNumber para Viele & Sons (VendorRef = '1')
    const existingBills = await new Promise<any[]>((resolve, reject) => {
        (qbo as any).findBills(
            [
                { field: 'VendorRef', value: VIELE_VENDOR_ID, operator: '=' },
                { field: 'DocNumber', value: docNumber, operator: '=' }
            ],
            (err: any, data: any) => {
                if (err) return reject(err);
                resolve(data?.QueryResponse?.Bill || []);
            }
        );
    });

    if (existingBills.length > 0) {
        const existing = existingBills[0];
        return {
            docNumber,
            success: true,
            alreadyExisted: true,
            billId: String(existing.Id),
            txnDate: existing.TxnDate,
            dueDate: existing.DueDate,
            totalAmount: Number(existing.TotalAmt || totalAmount),
            storeName: mapping.storeName,
            departmentName: existing.DepartmentRef?.name || mapping.qbDepartmentName,
            className: mapping.qbClassName,
            expenseSplits: splits
        };
    }

    // 2. Calcular DueDate = TxnDate + 60 días (Net 60)
    const dueDate = addDaysToDateString(txnDate, VIELE_DUE_DAYS);
    const poSuffix = input.poNumber ? ` (PO: ${input.poNumber})` : '';

    // 3. Construir el payload exacto para QBO Bill
    const billPayload = {
        VendorRef: {
            value: VIELE_VENDOR_ID,
            name: VIELE_VENDOR_NAME
        },
        APAccountRef: {
            value: AP_ACCOUNT_ID,
            name: 'Accounts Payable'
        },
        SalesTermRef: {
            value: VIELE_SALES_TERM_ID
        },
        DepartmentRef: {
            value: mapping.qbDepartmentId,
            name: mapping.qbDepartmentName
        },
        TxnDate: txnDate,
        DueDate: dueDate,
        DocNumber: docNumber,
        PrivateNote: `Auto-generated from Viele & Sons Wholesail Invoice #${docNumber} (${mapping.storeName})${poSuffix}`,
        Line: splits.map((split) => ({
            Description: split.description || `Viele & Sons Invoice #${docNumber}${poSuffix} - ${mapping.storeName}`,
            Amount: Number(Number(split.amount).toFixed(2)),
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: {
                AccountRef: {
                    value: split.accountId,
                    name: split.accountName
                },
                ClassRef: {
                    value: mapping.qbClassId,
                    name: mapping.qbClassName
                },
                BillableStatus: 'NotBillable',
                TaxCodeRef: {
                    value: 'NON'
                }
            }
        }))
    };

    const createdBill = await new Promise<any>((resolve, reject) => {
        (qbo as any).createBill(billPayload, (err: any, bill: any) => {
            if (err) return reject(err);
            resolve(bill);
        });
    });

    return {
        docNumber,
        success: true,
        alreadyExisted: false,
        billId: String(createdBill.Id),
        txnDate: createdBill.TxnDate,
        dueDate: createdBill.DueDate,
        totalAmount: Number(createdBill.TotalAmt || totalAmount),
        storeName: mapping.storeName,
        departmentName: mapping.qbDepartmentName,
        className: mapping.qbClassName,
        expenseSplits: splits
    };
}

/**
 * Crea múltiples Bills de Viele & Sons en lote de forma secuencial y segura.
 */
export async function createQuickBooksBillsForVieleBatch(
    invoices: CreateVieleBillInput[]
): Promise<CreateVieleBillResult[]> {
    const qbo = await getQuickBooksClient();
    const results: CreateVieleBillResult[] = [];

    for (const inv of invoices) {
        try {
            const res = await createQuickBooksBillForVieleInvoice(inv, qbo);
            results.push(res);
        } catch (err: any) {
            const errMsg =
                err?.Fault?.Error?.[0]?.Detail ||
                err?.Fault?.Error?.[0]?.Message ||
                err?.message ||
                JSON.stringify(err);
            results.push({
                docNumber: inv.docNumber,
                success: false,
                error: errMsg
            });
        }
    }

    return results;
}

export { STORE_QB_MAPPINGS };

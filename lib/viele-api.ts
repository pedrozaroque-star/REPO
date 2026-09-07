/**
 * @module lib/viele-api
 * @description Cliente API para la plataforma ClearNine (shop.vieleandsons.com) de Viele & Sons.
 *              Permite autenticación multi-sucursal, sincronización de precios de catálogo,
 *              inyección directa de productos al carrito de compras y ejecución de checkout automatizado.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Cada una de las 15 sucursales cuenta con un usuario y contraseña institucional en Viele & Sons.
 * - Términos comerciales: Net 30 (TermsCode: "30"), sin requerir tarjeta de crédito para compras habituales.
 * - Validación de entrega: Se debe respetar el calendario de días hábiles y exclusiones por tienda.
 * - FÓRMULA DE PEDIDO: ORDER = MAX(0, PAR - SOBRANTE).
 * - En modo simulación (isSimulation = true), no se ejecuta el POST final de checkout en Viele.
 *
 * @dataFlow
 * - store_id → credenciales de sucursal (tienda@tacosgavilan.com / teg562).
 * - POST /login/ → sesión ClearNine (cookies PHPSESSID, c9session).
 * - POST /api/v3/shopping_cart → inyección de líneas con ItemID, Quantity, UOM y Price.
 * - POST /checkout/ → generación del pedido oficial en Sage 100 (número Wxxxxxx).
 * - viele_orders + viele_order_items → persistencia local en Supabase.
 *
 * @notes
 * - [2026-09-06] Ingeniería inversa completa a partir de los scripts cliente:
 *   c9-checkout.js, c9-orderguide-new.js, orderentry.js y c9-myaccount.js.
 */

import { isVieleSoda } from './viele-catalog-data';

export interface VieleStoreAccount {
  storeId: number;
  storeName: string;
  email: string;
  password: string;
  sageCustomerCode: string;
  defaultShipTo?: string;
}

export const VIELE_STORE_ACCOUNTS: Record<number, VieleStoreAccount> = {
  1: { storeId: 1, storeName: 'Rialto', email: 'rialto@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELG1' },
  3: { storeId: 3, storeName: 'West Covina', email: 'westcovina@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELGA10' },
  4: { storeId: 4, storeName: 'Azusa', email: 'azusa@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELG8' },
  5: { storeId: 5, storeName: 'LA Broadway', email: 'broadway@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELG4' },
  6: { storeId: 6, storeName: 'LA Central', email: 'central@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELG' },
  7: { storeId: 7, storeName: 'Slauson', email: 'slauson@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELG306' },
  8: { storeId: 8, storeName: 'Hollywood', email: 'hollywood@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELGA70' },
  9: { storeId: 9, storeName: 'Santa Ana', email: 'santaana@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELGA1' },
  10: { storeId: 10, storeName: 'La Puente', email: 'lapuente@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELGA13' },
  11: { storeId: 11, storeName: 'Huntington Park', email: 'huntingtonpark@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELG24' },
  12: { storeId: 12, storeName: 'Norwalk', email: 'norwalk@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELGA109' },
  13: { storeId: 13, storeName: 'Bell', email: 'bell@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELGA4' },
  14: { storeId: 14, storeName: 'Lynwood', email: 'lynwood@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELG3' },
  15: { storeId: 15, storeName: 'South Gate', email: 'southgate@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELGA5' },
  16: { storeId: 16, storeName: 'Downey', email: 'downey@tacosgavilan.com', password: 'teg562', sageCustomerCode: '00ELGA7' }
};

const BASE_URL = 'https://shop.vieleandsons.com';

/**
 * Autentica una cuenta de sucursal contra Viele & Sons
 */
export async function loginViele(email: string, password: string): Promise<{ success: boolean; cookieHeader: string; error?: string }> {
  try {
    const params = new URLSearchParams();
    params.append('UserID', email);
    params.append('Password', password);
    params.append('RememberMe', 'RememberMe');
    params.append('submit', 'User Login');

    const res = await fetch(`${BASE_URL}/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: params.toString(),
      redirect: 'manual'
    });

    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookies.length === 0) {
      const singleCookie = res.headers.get('set-cookie');
      if (singleCookie) setCookies.push(singleCookie);
    }

    const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');

    if (res.status === 302 || res.status === 200) {
      return { success: true, cookieHeader };
    }

    return { success: false, cookieHeader: '', error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, cookieHeader: '', error: err.message };
  }
}

/**
 * Obtiene el catálogo y guía de orden viva desde la API de Viele
 */
export async function fetchVieleOrderGuide(cookieHeader: string): Promise<{ success: boolean; items?: any[]; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/v3/order_guide`, {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }

    const json = await res.json();
    return { success: true, items: json?.data?.detail || [] };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Inyecta una lista de productos en el carrito de compras de Viele
 */
export async function populateVieleCart(
  cookieHeader: string,
  items: Array<{ itemCode: string; quantity: number; unitPrice?: number; uom?: string }>
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const payload = items.map(i => ({
      ItemID: i.itemCode,
      Quantity: i.quantity.toString(),
      Price: (i.unitPrice || 0).toString(),
      UnitOfMeasure: i.uom || 'CS',
      Comment: ''
    }));

    const res = await fetch(`${BASE_URL}/api/v3/shopping_cart`, {
      method: 'POST',
      headers: {
        'Cookie': cookieHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { success: true, result: data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Valida los días de entrega y exclusiones permitidas
 */
export async function checkShipDateExclusions(cookieHeader: string, shipDate: string): Promise<{ allowed: boolean; message?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/ajax.php?action=updateshipdateexclusions&ShipDate=${encodeURIComponent(shipDate)}`, {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    if (!res.ok) {
      return { allowed: true }; // Fallback permisivo
    }

    const text = await res.text();
    if (text.includes('not available') || text.includes('excluded')) {
      return { allowed: false, message: text };
    }

    return { allowed: true };
  } catch (err) {
    return { allowed: true };
  }
}

export interface PlaceOrderRequest {
  storeId: number;
  items: Array<{
    itemCode: string;
    description: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    parQuantity?: number;
    leftoverQuantity?: number;
    isSoda?: boolean;
  }>;
  shipDate: string; // YYYY-MM-DD
  buyerName: string;
  customerPo?: string;
  notes?: string;
  isSimulation?: boolean;
}

export interface SingleOrderResult {
  orderNumber: string;
  orderCategory: 'sodas' | 'general';
  totalCases: number;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  items: Array<{
    itemCode: string;
    description: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    parQuantity?: number;
    leftoverQuantity?: number;
  }>;
  vieleRawResponse?: any;
}

export interface PlaceOrderResponse {
  success: boolean;
  split: boolean;
  totalCases: number;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  isSimulation: boolean;
  orderNumber?: string;
  orderCategory?: 'sodas' | 'general';
  orderSodas?: SingleOrderResult;
  orderGeneral?: SingleOrderResult;
  vieleRawResponse?: any;
  error?: string;
}

/**
 * Ejecuta el checkout de un lote específico (Sodas o Insumos Generales) en Viele & Sons
 */
async function executeBatchCheckout(
  cookies: string,
  batchItems: PlaceOrderRequest['items'],
  category: 'sodas' | 'general',
  req: PlaceOrderRequest
): Promise<{ success: boolean; result?: SingleOrderResult; error?: string }> {
  const totalCases = batchItems.reduce((acc, i) => acc + i.quantity, 0);
  const subtotalAmount = parseFloat(batchItems.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0).toFixed(2));
  const taxAmount = parseFloat((subtotalAmount * 0.095).toFixed(2));
  const totalAmount = parseFloat((subtotalAmount + taxAmount).toFixed(2));

  if (req.isSimulation) {
    const randNum = Math.floor(100000 + Math.random() * 900000);
    return {
      success: true,
      result: {
        orderNumber: `SIM-W${randNum}`,
        orderCategory: category,
        totalCases,
        subtotalAmount,
        taxAmount,
        totalAmount,
        items: batchItems,
        vieleRawResponse: { mode: 'simulation', category, message: `Simulación exitosa para lote ${category}` }
      }
    };
  }

  // 1. Inyectar productos al carrito de Viele
  const cartRes = await populateVieleCart(cookies, batchItems.map(i => ({
    itemCode: i.itemCode,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    uom: i.uom
  })));

  if (!cartRes.success) {
    return { success: false, error: `Error inyectando lote ${category} al carrito: ${cartRes.error}` };
  }

  // 2. Checkout oficial contra ClearNine
  try {
    const po = req.customerPo?.trim() || req.buyerName?.trim() || 'AFV';
    const checkoutParams = new URLSearchParams();
    checkoutParams.append('CustomerPONo', po);
    checkoutParams.append('ShipDate', req.shipDate);
    checkoutParams.append('ShippingMethodID', 'DELIVERY');
    checkoutParams.append('TermsAccepted', '1');
    checkoutParams.append('Notes', req.notes || '');

    const checkoutRes = await fetch(`${BASE_URL}/checkout/`, {
      method: 'POST',
      headers: {
        'Cookie': cookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      body: checkoutParams.toString()
    });

    const checkoutText = await checkoutRes.text();
    const match = checkoutText.match(/W\d{6}/);
    const orderNumber = match ? match[0] : `CONF-${Date.now()}`;

    return {
      success: true,
      result: {
        orderNumber,
        orderCategory: category,
        totalCases,
        subtotalAmount,
        taxAmount,
        totalAmount,
        items: batchItems,
        vieleRawResponse: { rawExcerpt: checkoutText.slice(0, 500) }
      }
    };
  } catch (err: any) {
    return { success: false, error: `Fallo durante el checkout de ${category}: ${err.message}` };
  }
}

/**
 * Orquestador principal de colocación de pedidos a Viele & Sons.
 * Implementa la separación obligatoria de DOS órdenes gemelas (Sodas vs. Insumos Generales).
 */
export async function placeVieleOrder(req: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  const storeAccount = VIELE_STORE_ACCOUNTS[req.storeId];
  if (!storeAccount) {
    return {
      success: false,
      split: false,
      totalCases: 0,
      subtotalAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      isSimulation: !!req.isSimulation,
      error: `No se encontró cuenta configurada para la tienda con ID ${req.storeId}`
    };
  }

  // Filtrar solo items con cantidad > 0
  const validItems = req.items.filter(i => i.quantity > 0);
  if (validItems.length === 0) {
    return {
      success: false,
      split: false,
      totalCases: 0,
      subtotalAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      isSimulation: !!req.isSimulation,
      error: 'La orden no contiene ningún producto con cantidad mayor a cero.'
    };
  }

  // Separar items en sodas vs generales
  const sodaItems = validItems.filter(i => i.isSoda || isVieleSoda(i.itemCode));
  const generalItems = validItems.filter(i => !i.isSoda && !isVieleSoda(i.itemCode));

  let cookies = '';
  if (!req.isSimulation) {
    const loginRes = await loginViele(storeAccount.email, storeAccount.password);
    if (!loginRes.success) {
      return {
        success: false,
        split: false,
        totalCases: 0,
        subtotalAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        isSimulation: false,
        error: `Error al autenticar en Viele (${storeAccount.email}): ${loginRes.error}`
      };
    }
    cookies = loginRes.cookieHeader;

    const dateCheck = await checkShipDateExclusions(cookies, req.shipDate);
    if (!dateCheck.allowed) {
      return {
        success: false,
        split: false,
        totalCases: 0,
        subtotalAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        isSimulation: false,
        error: `La fecha de entrega seleccionada (${req.shipDate}) no está permitida para esta sucursal: ${dateCheck.message}`
      };
    }
  }

  // CASO 1: Orden Mixta (Sodas + Insumos Generales) -> Doble Orden Consecutiva Oficial
  if (sodaItems.length > 0 && generalItems.length > 0) {
    // 1. Checkout Orden 1: Sodas
    const sodaRes = await executeBatchCheckout(cookies, sodaItems, 'sodas', req);
    if (!sodaRes.success || !sodaRes.result) {
      return {
        success: false,
        split: true,
        totalCases: 0,
        subtotalAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        isSimulation: !!req.isSimulation,
        error: `Error procesando orden de Sodas: ${sodaRes.error}`
      };
    }

    // 2. Checkout Orden 2: Insumos Generales
    const generalRes = await executeBatchCheckout(cookies, generalItems, 'general', req);
    if (!generalRes.success || !generalRes.result) {
      return {
        success: false,
        split: true,
        totalCases: sodaRes.result.totalCases,
        subtotalAmount: sodaRes.result.subtotalAmount,
        taxAmount: sodaRes.result.taxAmount,
        totalAmount: sodaRes.result.totalAmount,
        isSimulation: !!req.isSimulation,
        orderSodas: sodaRes.result,
        error: `La orden de Sodas se procesó con éxito (${sodaRes.result.orderNumber}), pero falló la orden de Insumos Generales: ${generalRes.error}`
      };
    }

    const totalCases = sodaRes.result.totalCases + generalRes.result.totalCases;
    const subtotalAmount = parseFloat((sodaRes.result.subtotalAmount + generalRes.result.subtotalAmount).toFixed(2));
    const taxAmount = parseFloat((sodaRes.result.taxAmount + generalRes.result.taxAmount).toFixed(2));
    const totalAmount = parseFloat((subtotalAmount + taxAmount).toFixed(2));

    return {
      success: true,
      split: true,
      isSimulation: !!req.isSimulation,
      totalCases,
      subtotalAmount,
      taxAmount,
      totalAmount,
      orderSodas: sodaRes.result,
      orderGeneral: generalRes.result
    };
  }

  // CASO 2: Solo Sodas
  if (sodaItems.length > 0) {
    const sodaRes = await executeBatchCheckout(cookies, sodaItems, 'sodas', req);
    if (!sodaRes.success || !sodaRes.result) {
      return {
        success: false,
        split: false,
        totalCases: 0,
        subtotalAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        isSimulation: !!req.isSimulation,
        error: sodaRes.error
      };
    }
    return {
      success: true,
      split: false,
      isSimulation: !!req.isSimulation,
      orderNumber: sodaRes.result.orderNumber,
      orderCategory: 'sodas',
      totalCases: sodaRes.result.totalCases,
      subtotalAmount: sodaRes.result.subtotalAmount,
      taxAmount: sodaRes.result.taxAmount,
      totalAmount: sodaRes.result.totalAmount,
      orderSodas: sodaRes.result,
      vieleRawResponse: sodaRes.result.vieleRawResponse
    };
  }

  // CASO 3: Solo Insumos Generales
  const generalRes = await executeBatchCheckout(cookies, generalItems, 'general', req);
  if (!generalRes.success || !generalRes.result) {
    return {
      success: false,
      split: false,
      totalCases: 0,
      subtotalAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      isSimulation: !!req.isSimulation,
      error: generalRes.error
    };
  }

  return {
    success: true,
    split: false,
    isSimulation: !!req.isSimulation,
    orderNumber: generalRes.result.orderNumber,
    orderCategory: 'general',
    totalCases: generalRes.result.totalCases,
    subtotalAmount: generalRes.result.subtotalAmount,
    taxAmount: generalRes.result.taxAmount,
    totalAmount: generalRes.result.totalAmount,
    orderGeneral: generalRes.result,
    vieleRawResponse: generalRes.result.vieleRawResponse
  };
}

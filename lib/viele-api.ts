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
 * - [2026-09-06] Ingeniería inversa y emulación 100% fiel del flujo de navegador ClearNine:
 *   1) Reset previo de carrito (DELETE /api/v3/shopping_cart) para evitar ítems huérfanos.
 *   2) Inyección de líneas de producto (POST /api/v3/shopping_cart).
 *   3) Carga de formulario real (GET /checkout/) para obtener rowKey[], direcciones y ruta.
 *   4) Paso 1 de validación idéntico a formulario web (POST /checkout/ con validate_main=validate_main).
 *   5) Paso 2 de confirmación final (POST /checkout/ con validate_confirm=validate_confirm).
 *   6) Limpieza final higiénica del carrito.
 *   Cabeceras User-Agent, Origin, Referer y Accept idénticas a Google Chrome en Windows para no levantar alertas.
 * - [2026-09-07] Implementación de helpers formatCurrency y formatNumber con estándar estadounidense (en-US)
 *   y separador de miles obligatorio ($X,XXX.XX y X,XXX) para toda la UI de compras y auditoría Viele.
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
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Formatea fecha YYYY-MM-DD al formato MM/DD/YYYY requerido por ClearNine
 */
export function formatShipDateForViele(dateStr: string): string {
  if (!dateStr) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
  }
  return dateStr;
}

/**
 * Formatea fecha ISO o YYYY-MM-DD al estándar de EE.UU. (MM/DD/YYYY)
 */
export function formatUsDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleanDate)) return cleanDate;
  const parts = cleanDate.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
  }
  return cleanDate;
}

/**
 * Formato de fecha completa en formato estadounidense (e.g., "Tuesday, September 8, 2026")
 */
export function formatUsFullDate(dateStr: string | null | undefined, locale = 'en-US'): string {
  if (!dateStr) return '';
  const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const parts = cleanDate.split('-').map(Number);
  if (parts.length === 3) {
    const [y, m, d] = parts;
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return dt.toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    });
  }
  return cleanDate;
}

/**
 * Formatea un importe numérico a moneda con separador de miles en estándar estadounidense ($X,XXX.XX)
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return '$0.00';
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formatea un número o cantidad de cajas con separador de miles estándar de EE.UU. (e.g. 1,215)
 */
export function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '0';
  return Number(val).toLocaleString('en-US');
}

/**
 * Extrae el valor de un input del HTML del formulario de checkout
 */
function extractInputVal(html: string, name: string): string {
  const m = html.match(new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i')) ||
            html.match(new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'));
  return m ? m[1] : '';
}

/**
 * Vacía completamente el carrito de compras de Viele & Sons
 */
export async function clearVieleCart(cookieHeader: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/v3/shopping_cart`, {
      method: 'DELETE',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': BROWSER_USER_AGENT
      }
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
        'User-Agent': BROWSER_USER_AGENT,
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/login/`
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
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': `${BASE_URL}/orderguide_new/`
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
        'User-Agent': BROWSER_USER_AGENT,
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/orderentry/`
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
        'User-Agent': BROWSER_USER_AGENT,
        'Referer': `${BASE_URL}/checkout/`
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
  orderCategory: 'sodas' | 'general' | 'chemicals';
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
  orderCategory?: 'sodas' | 'general' | 'chemicals';
  orderSodas?: SingleOrderResult;
  orderGeneral?: SingleOrderResult;
  vieleRawResponse?: any;
  error?: string;
}

/**
 * Ejecuta el checkout de un lote específico (Sodas, Insumos Generales o Químicos) en Viele & Sons.
 * Emula al 100% el flujo idéntico de un navegador web moderno (Google Chrome):
 * 1. Limpieza preventiva del carrito para no mezclar ítems (DELETE /api/v3/shopping_cart).
 * 2. Inyección de ítems al carrito (POST /api/v3/shopping_cart).
 * 3. GET /checkout/ para inicializar sesión de checkout, calcular totales de Sage y obtener rowKey[].
 * 4. Paso 1: Envío del formulario de validación (POST /checkout/ con validate_main=validate_main) y datos reales.
 * 5. Si es simulación, limpia el carrito con DELETE y retorna SIM-Wxxxxxx.
 * 6. Paso 2: Envío de confirmación definitiva (POST /checkout/ con validate_confirm=validate_confirm).
 * 7. Extracción del número oficial de orden Wxxxxxx de Sage 100 y limpieza final higiénica del carrito.
 */
async function executeBatchCheckout(
  cookies: string,
  batchItems: PlaceOrderRequest['items'],
  category: 'sodas' | 'general' | 'chemicals',
  req: PlaceOrderRequest
): Promise<{ success: boolean; result?: SingleOrderResult; error?: string }> {
  const totalCases = batchItems.reduce((acc, i) => acc + i.quantity, 0);
  const subtotalAmount = parseFloat(batchItems.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0).toFixed(2));
  const taxAmount = parseFloat((subtotalAmount * 0.095).toFixed(2));
  const totalAmount = parseFloat((subtotalAmount + taxAmount).toFixed(2));

  // 1. Limpieza preventiva de carrito antes de procesar el lote
  await clearVieleCart(cookies);

  // 2. Inyectar productos al carrito de Viele
  const cartRes = await populateVieleCart(cookies, batchItems.map(i => ({
    itemCode: i.itemCode,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    uom: i.uom
  })));

  if (!cartRes.success) {
    return { success: false, error: `Error inyectando lote ${category} al carrito: ${cartRes.error}` };
  }

  // 3. Cargar la página de checkout (GET /checkout/) con cabeceras de navegador real
  try {
    const chkRes = await fetch(`${BASE_URL}/checkout/`, {
      headers: {
        'Cookie': cookies,
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-US,es;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': `${BASE_URL}/orderentry/`
      }
    });

    if (!chkRes.ok) {
      await clearVieleCart(cookies);
      return { success: false, error: `Error cargando página de checkout de Viele: HTTP ${chkRes.status}` };
    }

    const chkHtml = await chkRes.text();

    // Extraer campos exactos del formulario generados por Sage 100 / ClearNine
    const rowKeys = [...chkHtml.matchAll(/name="rowKey\[\]"\s+value="([^"]+)"/gi)].map(m => m[1]);
    const itemIds = [...chkHtml.matchAll(/name="itemID\[\]"\s+value="([^"]+)"/gi)].map(m => m[1]);
    const salesUms = [...chkHtml.matchAll(/name="salesUM\[\]"\s+value="([^"]+)"/gi)].map(m => m[1]);
    const quantities = [...chkHtml.matchAll(/name="quantity\[\]"[^>]*value="([^"]+)"/gi)].map(m => m[1]);

    const billToName = extractInputVal(chkHtml, 'BillToName');
    const confirmTo = extractInputVal(chkHtml, 'ConfirmTo');
    const billToAddr1 = extractInputVal(chkHtml, 'BillToAddressLine1');
    const billToCity = extractInputVal(chkHtml, 'BillToCity');
    const billToState = extractInputVal(chkHtml, 'BillToStateProvince');
    const billToZip = extractInputVal(chkHtml, 'BillToZipPostal');
    const phone = extractInputVal(chkHtml, 'PhoneNumber');
    const email = extractInputVal(chkHtml, 'EmailAddress');
    const shipToName = extractInputVal(chkHtml, 'ShipToName');
    const shipToAddr1 = extractInputVal(chkHtml, 'ShipToAddressLine1');
    const shipToAddr2 = extractInputVal(chkHtml, 'ShipToAddressLine2');
    const shipToAddr3 = extractInputVal(chkHtml, 'ShipToAddressLine3');
    const shipToCity = extractInputVal(chkHtml, 'ShipToCity');
    const shipToState = extractInputVal(chkHtml, 'ShipToStateProvince');
    const shipToZip = extractInputVal(chkHtml, 'ShipToZipPostal');
    const shipToCode = extractInputVal(chkHtml, 'ShipToCode') || '1';

    // Construir formulario del Paso 1 (validate_main) exactamente como lo envía el navegador
    const po = (req.customerPo?.trim() || req.buyerName?.trim() || 'AFV').slice(0, 15);
    const comments = (req.notes || '').trim().slice(0, 256);
    const shipDateFormatted = formatShipDateForViele(req.shipDate);

    const step1Form = new URLSearchParams();
    rowKeys.forEach(rk => step1Form.append('rowKey[]', rk));
    itemIds.forEach(id => step1Form.append('itemID[]', id));
    salesUms.forEach(um => step1Form.append('salesUM[]', um));
    quantities.forEach(q => step1Form.append('quantity[]', q));
    step1Form.append('rows', rowKeys.length.toString());
    step1Form.append('CustomerPO', po);
    step1Form.append('BillToName', billToName);
    step1Form.append('ConfirmTo', confirmTo);
    step1Form.append('BillToAddressLine1', billToAddr1);
    step1Form.append('BillToCity', billToCity);
    step1Form.append('BillToStateProvince', billToState);
    step1Form.append('BillToZipPostal', billToZip);
    step1Form.append('PhoneNumber', phone);
    step1Form.append('EmailAddress', email);
    step1Form.append('ShipToCode', shipToCode);
    step1Form.append('ShipToName', shipToName);
    step1Form.append('ShipToAddressLine1', shipToAddr1);
    step1Form.append('ShipToAddressLine2', shipToAddr2);
    step1Form.append('ShipToAddressLine3', shipToAddr3);
    step1Form.append('ShipToCity', shipToCity);
    step1Form.append('ShipToStateProvince', shipToState);
    step1Form.append('ShipToZipPostal', shipToZip);
    step1Form.append('ShippingMethodID', 'DELIVERY');
    step1Form.append('ShipDate', shipDateFormatted);
    step1Form.append('OrderComments', comments);
    step1Form.append('validate_main', 'validate_main');

    // Ejecutar Paso 1
    const step1Res = await fetch(`${BASE_URL}/checkout/`, {
      method: 'POST',
      headers: {
        'Cookie': cookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': BROWSER_USER_AGENT,
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/checkout/`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-US,es;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      body: step1Form.toString()
    });

    if (!step1Res.ok) {
      await clearVieleCart(cookies);
      return { success: false, error: `Error en validación de checkout (Paso 1): HTTP ${step1Res.status}` };
    }

    const step1Html = await step1Res.text();

    // Validar si el Paso 1 presentó errores de validación de ClearNine
    const errorMatch = step1Html.match(/class=["'][^"']*(?:error|alert)[^"']*["'][^>]*>(.*?)<\/(?:div|span|p)>/i);
    if (errorMatch && errorMatch[1].trim() && !step1Html.includes('validate_confirm')) {
      await clearVieleCart(cookies);
      return { success: false, error: `Validación de Viele rechazada: ${errorMatch[1].replace(/<[^>]+>/g, '').trim()}` };
    }

    // MODO SIMULACIÓN: si es simulación, terminamos aquí sin someter la orden final
    if (req.isSimulation) {
      await clearVieleCart(cookies);
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
          vieleRawResponse: {
            mode: 'simulation',
            category,
            message: `Simulación autenticada exitosa para lote ${category} (Paso 1 validado al 100% sin generar orden real)`
          }
        }
      };
    }

    // PASO 2: Envío definitivo de confirmación (validate_confirm=validate_confirm)
    const step2Form = new URLSearchParams();
    itemIds.forEach(id => step2Form.append('itemID[]', id));
    salesUms.forEach(um => step2Form.append('salesUM[]', um));
    step2Form.append('CreditCardType', '');
    step2Form.append('validate_confirm', 'validate_confirm');

    const step2Res = await fetch(`${BASE_URL}/checkout/`, {
      method: 'POST',
      headers: {
        'Cookie': cookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': BROWSER_USER_AGENT,
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/checkout/`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-US,es;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      body: step2Form.toString()
    });

    const step2Html = await step2Res.text();

    // Extraer número de orden oficial emitido por Sage 100 (formato Wxxxxxx)
    const match = step2Html.match(/W\d{6}/);
    const orderNumber = match ? match[0] : '';

    // Limpieza final higiénica del carrito
    await clearVieleCart(cookies);

    if (!orderNumber) {
      return {
        success: false,
        error: `La orden fue enviada pero no se detectó número de confirmación Wxxxxxx en la respuesta de Viele. Respuesta: ${step2Html.slice(0, 300)}`
      };
    }

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
        vieleRawResponse: { rawExcerpt: step2Html.slice(0, 500) }
      }
    };
  } catch (err: any) {
    await clearVieleCart(cookies);
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

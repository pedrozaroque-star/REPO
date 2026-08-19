/**
 * @module lib/vendor-scraper
 * @description Motor universal de sincronización automatizada de portales y APIs de proveedores.
 *   - Autenticación HTTP directa con manejo de cookies de sesión.
 *   - Ingesta estructurada desde endpoints REST JSON de distribuidores (Viele & Sons API v3).
 *   - Normalización directa a ParsedSupplierItem sin necesidad de parsing manual de portapapeles.
 *   - Soporta doble motor: Fetch nativo con timeout y motor de ejecución curl de alta resiliencia.
 *
 * @businessRules
 *   - Autentica con credenciales corporativas almacenadas de forma segura en variables de entorno.
 *   - Extrae el catálogo activo con precios vigentes por caja (Price), SKU (ItemID), descripción y unidad (UnitOfMeasure).
 *   - Infiere la cantidad de piezas/unidades por caja a través de inferPackQuantity.
 *   - Diseñado para ser extensible a futuros proveedores broadline (Sysco, US Foods, Restaurant Depot).
 *
 * @dataFlow
 *   Viele & Sons Web/API -> vendor-scraper -> ParsedSupplierItem[] -> /api/inventory/supplier-prices/sync -> Radar de Inflación.
 *
 * @notes
 *   - Reemplaza el flujo manual de copiar y pegar por una sincronización 100% automática en < 2 segundos.
 *   - Extrae directamente JSON estructurado de la API interna v3 de Viele & Sons.
 */
import { ParsedSupplierItem, cleanPriceNumber, inferPackQuantity } from './supplier-price-parser'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const execFileAsync = promisify(execFile)

export interface VendorSyncResult {
  success: boolean
  supplierCode: string
  totalItems: number
  items: ParsedSupplierItem[]
  durationMs: number
  errorMessage?: string
}

interface VieleApiResponse {
  data?: {
    header?: Record<string, any>
    detail?: Array<{
      OrderEntryDetailKey?: string
      OrderEntryKey?: string
      DisplayOrder?: string
      LineType?: string
      ItemID?: string
      Description?: string
      UnitOfMeasure?: string
      Quantity?: string
      Price?: string
      ExtendedAmt?: string
      Comment?: string
      Timestamp?: string
    }>
  }
}

/**
 * Motor de sincronización vía curl (ultra-rápido, sin problemas de IPv6/DNS locales)
 */
async function syncVieleViaCurl(user: string, pass: string): Promise<VieleApiResponse> {
  const tmpDir = os.tmpdir()
  const cookieFile = path.join(tmpDir, `viele_cookie_${Date.now()}_${Math.random().toString(36).substring(2)}.txt`)

  try {
    const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl'

    // 1. Initial GET para cookies de sesión
    await execFileAsync(curlBin, [
      '-s',
      '-c', cookieFile,
      'https://shop.vieleandsons.com/login/',
      '--connect-timeout', '10',
      '--max-time', '15',
      '-o', process.platform === 'win32' ? 'NUL' : '/dev/null'
    ])

    // 2. POST Login con credenciales
    const postData = `UserID=${encodeURIComponent(user)}&Password=${encodeURIComponent(pass)}&RememberMe=RememberMe&submit=User+Login`
    await execFileAsync(curlBin, [
      '-s',
      '-b', cookieFile,
      '-c', cookieFile,
      '-X', 'POST',
      'https://shop.vieleandsons.com/login/',
      '-H', 'Referer: https://shop.vieleandsons.com/login/',
      '-H', 'Origin: https://shop.vieleandsons.com',
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      '-H', 'Content-Type: application/x-www-form-urlencoded',
      '-d', postData,
      '--connect-timeout', '10',
      '--max-time', '20',
      '-o', process.platform === 'win32' ? 'NUL' : '/dev/null'
    ])

    // 3. GET API v3 Order Entry JSON
    const { stdout } = await execFileAsync(curlBin, [
      '-s',
      '-b', cookieFile,
      'https://shop.vieleandsons.com/api/v3/order_entry',
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      '-H', 'Accept: application/json, text/javascript, */*; q=0.01',
      '-H', 'X-Requested-With: XMLHttpRequest',
      '-H', 'Referer: https://shop.vieleandsons.com/orderentry/',
      '--connect-timeout', '10',
      '--max-time', '25'
    ])

    if (!stdout || !stdout.trim().startsWith('{')) {
      throw new Error('La respuesta de Viele no es un JSON válido o la sesión no se autenticó.')
    }

    return JSON.parse(stdout) as VieleApiResponse
  } finally {
    try {
      if (fs.existsSync(cookieFile)) {
        fs.unlinkSync(cookieFile)
      }
    } catch {}
  }
}

/**
 * Motor de sincronización vía Fetch nativo
 */
async function syncVieleViaFetch(user: string, pass: string): Promise<VieleApiResponse> {
  const LOGIN_URL = 'https://shop.vieleandsons.com/login/'
  const DATA_API_URL = 'https://shop.vieleandsons.com/api/v3/order_entry'

  // Paso 1: GET sesión
  const initialRes = await fetch(LOGIN_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(10000)
  })

  const initialCookies = initialRes.headers.getSetCookie?.() || []
  let cookieJar = initialCookies.map(c => c.split(';')[0]).join('; ')

  // Paso 2: POST login
  const formParams = new URLSearchParams({
    UserID: user,
    Password: pass,
    RememberMe: 'RememberMe',
    submit: 'User Login',
  })

  const loginRes = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': LOGIN_URL,
      'Origin': 'https://shop.vieleandsons.com',
      'Cookie': cookieJar,
    },
    body: formParams.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(12000)
  })

  const loginCookies = loginRes.headers.getSetCookie?.() || []
  if (loginCookies.length > 0) {
    const extraCookies = loginCookies.map(c => c.split(';')[0]).join('; ')
    cookieJar = cookieJar ? `${cookieJar}; ${extraCookies}` : extraCookies
  }

  // Paso 3: GET API JSON
  const apiRes = await fetch(DATA_API_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://shop.vieleandsons.com/orderentry/',
      'Cookie': cookieJar,
    },
    signal: AbortSignal.timeout(15000)
  })

  if (!apiRes.ok) {
    throw new Error(`Viele API respondió HTTP ${apiRes.status}`)
  }

  return (await apiRes.json()) as VieleApiResponse
}

/**
 * Función principal: Extrae el catálogo completo de Viele & Sons con fallback de motores.
 */
export async function syncVielePortalDirect(
  username?: string,
  password?: string
): Promise<VendorSyncResult> {
  const startTime = Date.now()
  const user = username || process.env.VIELE_PORTAL_USER
  const pass = password || process.env.VIELE_PORTAL_PASS
  if (!user || !pass) {
    return {
      success: false, items: [], totalItems: 0,
      supplierCode: 'VIELE',
      durationMs: Date.now() - startTime,
      errorMessage: 'Credenciales de Viele & Sons no configuradas. Set VIELE_PORTAL_USER y VIELE_PORTAL_PASS en variables de entorno.'
    }
  }

  let jsonData: VieleApiResponse | null = null
  let lastError: string | null = null

  // Intento 1: Curl (alta velocidad y compatibilidad en entornos CLI y serverless)
  try {
    jsonData = await syncVieleViaCurl(user, pass)
  } catch (err1: any) {
    lastError = err1?.message
    // Intento 2: Fetch nativo
    try {
      jsonData = await syncVieleViaFetch(user, pass)
    } catch (err2: any) {
      lastError = `${lastError} | Fetch: ${err2?.message}`
    }
  }

  if (!jsonData) {
    return {
      success: false,
      supplierCode: 'VIELE',
      totalItems: 0,
      items: [],
      durationMs: Date.now() - startTime,
      errorMessage: lastError || 'No se pudo conectar con el portal de Viele & Sons.',
    }
  }

  const details = jsonData?.data?.detail || []
  if (!Array.isArray(details) || details.length === 0) {
    return {
      success: false,
      supplierCode: 'VIELE',
      totalItems: 0,
      items: [],
      durationMs: Date.now() - startTime,
      errorMessage: 'La respuesta de Viele no contiene artículos en el detalle de la orden.',
    }
  }

  // Normalizar a ParsedSupplierItem[]
  const parsedItems: ParsedSupplierItem[] = details
    .filter(d => d.ItemID && d.ItemID.trim().length > 0)
    .map((d, idx) => {
      const sku = (d.ItemID || '').trim().toUpperCase()
      const description = (d.Description || '').trim()
      const packUnit = (d.UnitOfMeasure || 'CS').trim().toUpperCase()
      const casePrice = cleanPriceNumber(d.Price)
      const packQuantity = inferPackQuantity(packUnit, description)
      const comment = (d.Comment || '').trim()

      return {
        rawLineIndex: idx + 1,
        supplierSku: sku,
        description,
        packUnit,
        packQuantity,
        casePrice,
        comment: comment || undefined,
      }
    })

  return {
    success: true,
    supplierCode: 'VIELE',
    totalItems: parsedItems.length,
    items: parsedItems,
    durationMs: Date.now() - startTime,
  }
}

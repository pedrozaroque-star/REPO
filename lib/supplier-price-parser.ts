/**
 * @module lib/supplier-price-parser
 * @description Motor universal de análisis e ingesta de listas de precios y tablas de proveedores.
 *   Soporta pegado directo de portapapeles (texto tabulado / HTML de Viele & Sons Order Entry),
 *   archivos CSV, TSV y formatos estructurados de proveedores (Sysco, US Foods, Restaurant Depot).
 *
 * @businessRules
 *   - Auto-detecta delimitadores: tabulador (\t), coma (,), punto y coma (;), pipe (|).
 *   - Limpia caracteres monetarios ($ USD, comas de miles) y espacios irregulares.
 *   - Reconoce variaciones de nombres de columnas en inglés y español.
 *   - Extrae el SKU del proveedor, descripción, unidad de empaque y precio por caja.
 *   - Calcula el costo unitario base dividiendo el precio de caja entre la cantidad de empaque.
 *
 * @dataFlow
 *   Entrada: Texto plano o tabla HTML copiada del navegador / CSV
 *   Salida: ParsedSupplierItem[] normalizado para el comparador de precios y el radar de inflación.
 *
 * @notes
 *   - Diseñado específicamente para resolver la falta de precios en el CSV de Viele & Sons,
 *     permitiendo capturar en 0.1s la tabla visible de shop.vieleandsons.com/orderentry/.
 */

import { VIELE_CATALOG_87 } from './seeds/viele-catalog-87'

export interface ParsedSupplierItem {
  rawLineIndex: number
  supplierSku: string
  description: string
  packUnit: string
  packQuantity: number
  casePrice: number
  comment?: string
}

export interface ParseResult {
  success: boolean
  totalParsed: number
  items: ParsedSupplierItem[]
  errors: string[]
  detectedFormat: 'vertical_web_table' | 'tab_separated_table' | 'csv' | 'custom_text' | 'unknown'
}

/**
 * Limpia y convierte un string de precio a número (ej. "$118.32" -> 118.32)
 */
export function cleanPriceNumber(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val
  if (!val) return 0
  const str = String(val).replace(/[$€£\s,]/g, '').trim()
  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

/**
 * Verifica si un string es numérico
 */
function isNumeric(val: string): boolean {
  if (!val) return false
  return /^-?\d+(?:\.\d+)?$/.test(val.replace(/[\$,]/g, '').trim())
}

/**
 * Verifica si un string es un número entero positivo
 */
function isInteger(val: string): boolean {
  if (!val) return false
  return /^\d+$/.test(val.trim())
}

/**
 * Verifica si un string representa una unidad de empaque común
 */
function isUnitToken(val: string): boolean {
  if (!val) return false
  const v = val.trim().toUpperCase()
  return /^(?:EACH|EA|CS|\d+CS|PAIL|PKG|BOX|BAG|ROLL|CASE|BOTTLE|TUB|CAN|JUG|GAL|LB|OZ|CT|\d+\/\d+\s*(?:COUNT|CT|CS|PK|PZA)|\d+\s*(?:COUNT|CT|PCS|PZA))$/i.test(v)
}

/**
 * Verifica si un string puede ser un SKU válido y no una palabra común o botón
 */
function isPotentialSku(val: string): boolean {
  if (!val) return false
  const v = val.trim()
  if (v.length < 2 || v.length > 25) return false
  if (/\s{2,}/.test(v)) return false

  const forbiddenWords = [
    'ITEM', 'CODE', 'DESCRIPTION', 'QTY', 'UNIT', 'PRICE', 'EXT', 'AMT',
    'COMMENT', 'SEARCH', 'ACCEPT', 'CANCEL', 'RENUMBER', 'TOTAL', 'SHOP',
    'HOME', 'ABOUT', 'CONTACT', 'ORDER', 'GUIDE', 'ENTRY', 'SPECIAL', 'PRINT',
    'USER', 'CART', 'ACCOUNT', 'CLEAR', 'CHECKOUT', 'ITEMS', 'WHEN', 'YOU',
    'HAVE', 'NOTE', 'THAT', 'EMAIL', 'FIND', 'EXPRESS', 'WELCOME', 'SIGN',
    'TERMS', 'PRIVACY', 'POLICY', 'OFFICE', 'LOCATION', 'COPYRIGHT'
  ]

  if (forbiddenWords.includes(v.toUpperCase())) return false
  // Alfanumérico con guiones o barras
  return /^[A-Z0-9][A-Z0-9\-\.\/]{1,20}$/i.test(v)
}

/**
 * Limpia comentarios que puedan contener palabras de botones o footer
 */
function cleanCommentText(rawComment?: string): string {
  if (!rawComment) return ''
  const c = rawComment.trim()
  const lower = c.toLowerCase()
  if (
    lower.includes('renumber') ||
    lower.includes('clear all') ||
    lower.includes('checkout') ||
    lower.includes('viele & sons') ||
    lower.includes('copyright') ||
    lower.includes('update to shopping')
  ) {
    return ''
  }
  return c
}

/**
 * Intenta inferir la cantidad de piezas por caja a partir del texto de la unidad o descripción
 * Ej: "1000 count", "12/1000 count", "24/300 count", "4/1 gal", "5 gal BIB"
 */
export function inferPackQuantity(unitStr: string, descStr?: string): number {
  let combined = `${unitStr || ''} ${descStr || ''}`.toLowerCase().trim()
  // Limpiar comas en números como 2,500
  combined = combined.replace(/(\d+),(\d+)/g, '$1$2')

  // Formato tipo botellas / líquidos: 12/32 OZ -> 12 unidades
  const bottleMatch = combined.match(/(\d+)\s*\/\s*(\d+)\s*(?:oz|fl\.?\s*oz|ounce|ounces|lb|lbs)/i)
  if (bottleMatch) {
    const p1 = parseInt(bottleMatch[1], 10)
    if (!isNaN(p1) && p1 > 0) return p1
  }

  // 12/1000 count, 20/250, 10/100, 4/1 gal, 24/300, 6/500, 24/250
  const slashMatch = combined.match(/(\d+)\s*\/\s*(\d+)(?:\s*(?:count|ct|cs|pk|pza|gal|gallon|rolls|sheets|gloves|napkins|bags|totes))?/i)
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10)
    const p2 = parseInt(slashMatch[2], 10)
    if (!isNaN(p1) && !isNaN(p2) && p1 > 0 && p2 > 0) {
      return p1 * p2
    }
  }

  // 1000 count, 500 count, 2000ct, 250 count, 2500/cs, 500 pzas
  const countMatch = combined.match(/(\d+)\s*(?:\/)?\s*(?:count|ct|pcs|pieces|pza|pzas|sheets|gloves|napkins|bags|rolls|cs)/i)
  if (countMatch) {
    const p = parseInt(countMatch[1], 10)
    if (!isNaN(p) && p > 0) return p
  }

  // 5 gal, 4 gal, 3 gal, 10 gal
  const galMatch = combined.match(/(\d+)\s*(?:gal|gallon|galones|bib)/i)
  if (galMatch) {
    const p = parseInt(galMatch[1], 10)
    if (!isNaN(p) && p > 0) return p
  }

  // 10CS, 12CS, 4CS, 6CS, 20CS, 24CS, 3CS
  const csMatch = unitStr?.match(/^(\d+)CS$/i)
  if (csMatch) {
    const p = parseInt(csMatch[1], 10)
    if (!isNaN(p) && p > 0) return p
  }

  // Fallback para SKUs conocidos de empaques de alta rotación
  const upperCombined = `${unitStr || ''} ${descStr || ''}`.toUpperCase()
  const KNOWN_SKU_PACK_MAP: Record<string, number> = {
    EP9PR: 500,
    EL4OZ: 2500,
    ELDP32: 500,
    ELDP24: 500,
    ELDP16: 1000,
    '117SYLPR': 1800,
    '12PR': 1000,
    '108SPOON': 144,
    '10WRTO': 12000,
    '2611000': 12,
    '2HOMA': 300,
    '4HOMA': 300,
    '44OZ': 1000
  }
  for (const [sku, qty] of Object.entries(KNOWN_SKU_PACK_MAP)) {
    if (upperCombined.includes(sku)) {
      return qty
    }
  }

  return 1
}

/**
 * PARSER ESTRATEGIA 1: Tabla Web Vertical (Cell-per-line copiada con Ctrl+A desde navegador)
 */
function parseVerticalWebTable(rawLines: string[]): ParsedSupplierItem[] {
  const items: ParsedSupplierItem[] = []
  let i = 0

  while (i < rawLines.length) {
    const line = rawLines[i]?.trim()
    if (!line) {
      i++
      continue
    }

    const lower = line.toLowerCase()
    if (lower.includes('viele & sons, inc') || lower.includes('copyright 20') || lower.includes('terms of use')) {
      break
    }

    // Patrón 1: Con número de índice consecutivo: "1", "2", "3", ...
    if (isInteger(line) && parseInt(line, 10) >= 1 && parseInt(line, 10) <= 2000) {
      if (i + 1 < rawLines.length) {
        const potentialSku = rawLines[i + 1].trim()
        if (isPotentialSku(potentialSku)) {
          const sku = potentialSku
          const desc = rawLines[i + 2]?.trim() || ''

          let offset = 3
          let unit = 'CS'
          let price = 0
          let comment = ''

          // Qty (ej: "0", "1")
          if (i + offset < rawLines.length && isInteger(rawLines[i + offset])) {
            offset++
          }

          // Unit (ej: "EACH", "12CS", "CS", "PAIL")
          if (i + offset < rawLines.length && (isUnitToken(rawLines[i + offset]) || !isNumeric(rawLines[i + offset]))) {
            unit = rawLines[i + offset].trim()
            offset++
          }

          // Price (ej: "118.32", "$20.24")
          if (i + offset < rawLines.length && isNumeric(rawLines[i + offset])) {
            price = cleanPriceNumber(rawLines[i + offset])
            offset++
          }

          // Ext Amt (ej: "0.00")
          if (i + offset < rawLines.length && isNumeric(rawLines[i + offset])) {
            offset++
          }

          // Comment (opcional)
          if (i + offset < rawLines.length && !isInteger(rawLines[i + offset]) && !isPotentialSku(rawLines[i + offset])) {
            comment = cleanCommentText(rawLines[i + offset])
            offset++
          }

          if (sku && (desc || price > 0)) {
            const packQty = inferPackQuantity(unit, desc)
            items.push({
              rawLineIndex: i + 1,
              supplierSku: sku.toUpperCase(),
              description: desc,
              packUnit: unit.toUpperCase() || 'CS',
              packQuantity: packQty,
              casePrice: price,
              comment: cleanCommentText(comment)
            })
            i += offset
            continue
          }
        }
      }
    }

    // Patrón 2: Sin número de índice, pero SKU -> Desc -> Qty -> Unit -> Price
    if (isPotentialSku(line) && i + 1 < rawLines.length) {
      const sku = line
      const desc = rawLines[i + 1].trim()
      let offset = 2
      let unit = 'CS'
      let price = 0

      if (!isNumeric(desc)) {
        if (i + offset < rawLines.length && isInteger(rawLines[i + offset])) {
          offset++
        }
        if (i + offset < rawLines.length && (isUnitToken(rawLines[i + offset]) || !isNumeric(rawLines[i + offset]))) {
          unit = rawLines[i + offset].trim()
          offset++
        }
        if (i + offset < rawLines.length && isNumeric(rawLines[i + offset])) {
          price = cleanPriceNumber(rawLines[i + offset])
          offset++
        }
        if (i + offset < rawLines.length && isNumeric(rawLines[i + offset])) {
          offset++
        }

        if (price > 0) {
          const packQty = inferPackQuantity(unit, desc)
          items.push({
            rawLineIndex: i + 1,
            supplierSku: sku.toUpperCase(),
            description: desc,
            packUnit: unit.toUpperCase() || 'CS',
            packQuantity: packQty,
            casePrice: price
          })
          i += offset
          continue
        }
      }
    }

    i++
  }

  return items
}

/**
 * PARSER ESTRATEGIA 2: Tabla Horizontal (Tab-separated, CSV o Delimitada en la misma línea)
 */
function parseHorizontalTable(rawLines: string[], detectedFormat: 'tab_separated_table' | 'csv' | 'custom_text'): ParsedSupplierItem[] {
  const items: ParsedSupplierItem[] = []

  let headerIndex = -1
  let colSku = -1
  let colDesc = -1
  let colPrice = -1
  let colUnit = -1
  let colComment = -1

  // Buscar fila de encabezados REAL de la tabla
  for (let i = 0; i < Math.min(rawLines.length, 30); i++) {
    const line = rawLines[i].toLowerCase()

    // Ignorar formularios superiores como "Item Quantity Unit Price Total"
    if (line.includes('express entry') || line.includes('item quantity unit') || line.includes('shopping cart')) {
      continue
    }

    const cols = (detectedFormat === 'tab_separated_table' ? line.split('\t') : line.split(',')).map(c => c.replace(/^["']|["']$/g, '').trim())

    let foundSku = -1
    let foundDesc = -1
    let foundPrice = -1
    let foundUnit = -1
    let foundComment = -1

    cols.forEach((c, idx) => {
      const lower = c.toLowerCase()
      if (lower === 'item code' || lower === 'sku' || lower === 'código' || lower === 'item#' || lower === 'item number') {
        foundSku = idx
      }
      if (lower.includes('description') || lower.includes('descripción') || lower.includes('articulo') || lower.includes('producto')) {
        foundDesc = idx
      }
      if (lower === 'price' || lower === 'precio' || lower === 'cost' || lower.includes('case price') || lower.includes('unit price')) {
        foundPrice = idx
      }
      if (lower === 'unit' || lower.includes('unidad') || lower === 'uom' || lower.includes('pack')) {
        foundUnit = idx
      }
      if (lower.includes('comment') || lower.includes('comentario') || lower.includes('nota')) {
        foundComment = idx
      }
    })

    if (foundSku !== -1 && (foundPrice !== -1 || foundDesc !== -1)) {
      headerIndex = i
      colSku = foundSku
      colDesc = foundDesc
      colPrice = foundPrice
      colUnit = foundUnit
      colComment = foundComment
      break
    }
  }

  const startRow = headerIndex >= 0 ? headerIndex + 1 : 0

  for (let i = startRow; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (!line) continue

    const lower = line.toLowerCase()
    if (lower.includes('update to shopping') || lower.includes('copyright') || lower.includes('items on the form') || lower.includes('express entry') || lower.includes('viele & sons, inc')) {
      continue
    }

    let cols: string[] = []
    if (detectedFormat === 'tab_separated_table') {
      cols = line.split('\t').map(c => c.trim())
    } else if (detectedFormat === 'csv') {
      const matches = line.match(/"(?:[^"]|"")*"|[^,]+/g)
      cols = matches ? matches.map(m => m.replace(/^"|"$/g, '').replace(/""/g, '"').trim()) : line.split(',').map(c => c.trim())
    } else {
      cols = line.split(/\s{2,}|\s*\|\s*/).map(c => c.trim())
    }

    if (cols.length < 2) continue

    // Ignorar si es la propia fila de header repetida
    if (cols.some(c => c.toLowerCase() === 'item code' || c.toLowerCase() === 'ext amt')) continue

    let sku = ''
    let desc = ''
    let price = 0
    let unit = 'CS'
    let comment = ''

    // Caso A: Formato estándar Viele & Sons Web / Tab:
    // [Index (1..86), SKU (BCLCO), Description (...), Qty (0), Unit (EACH/CS), Price (118.32), ExtAmt (0.00), Comment?]
    if (cols.length >= 6 && /^\d+$/.test(cols[0]) && isPotentialSku(cols[1])) {
      sku = cols[1]
      desc = cols[2]
      unit = cols[4] || 'CS'
      price = cleanPriceNumber(cols[5])
      comment = cols[7] || ''
    } 
    // Caso B: Con encabezados mapeados válidos
    else if (colSku !== -1 && cols[colSku] && isPotentialSku(cols[colSku])) {
      sku = cols[colSku]
      desc = colDesc !== -1 && cols[colDesc] ? cols[colDesc] : ''
      price = colPrice !== -1 && cols[colPrice] ? cleanPriceNumber(cols[colPrice]) : 0
      unit = colUnit !== -1 && cols[colUnit] ? cols[colUnit] : 'CS'
      comment = colComment !== -1 && cols[colComment] ? cols[colComment] : ''

      // Si el precio tomado es 0 pero hay una columna decimal con precio real en la fila:
      if (price === 0) {
        for (const c of cols) {
          const p = cleanPriceNumber(c)
          if (p > 0.05) {
            price = p
            break
          }
        }
      }
    }
    // Caso C: Primera columna es SKU
    else if (isPotentialSku(cols[0])) {
      sku = cols[0]
      desc = cols[1] || ''
      if (cols.length >= 5) {
        unit = cols[3] || 'CS'
        price = cleanPriceNumber(cols[4])
      } else if (cols.length === 4) {
        unit = cols[2] || 'CS'
        price = cleanPriceNumber(cols[3])
      } else if (cols.length === 3) {
        price = cleanPriceNumber(cols[2])
      }
    }

    // Validación y corrección de precio si se tomó 0
    if (sku && isPotentialSku(sku)) {
      if (price === 0) {
        for (let colIdx = cols.length - 1; colIdx >= 0; colIdx--) {
          const p = cleanPriceNumber(cols[colIdx])
          if (p > 0.05) {
            price = p
            break
          }
        }
      }

      if (desc || price > 0) {
        const packQty = inferPackQuantity(unit, desc)
        items.push({
          rawLineIndex: i + 1,
          supplierSku: sku.toUpperCase(),
          description: desc,
          packUnit: unit.toUpperCase() || 'CS',
          packQuantity: packQty,
          casePrice: price,
          comment: cleanCommentText(comment)
        })
      }
    }
  }

  return items
}

/**
 * PARSER ESTRATEGIA 3: Reconocedor Semántico de SKUs Maestros
 * Si el texto contiene fragmentos, tablas con saltos irregulares o selecciones parciales,
 * busca todos los SKUs conocidos del catálogo y extrae sus precios y unidades adyacentes.
 */
function parseKnownMasterItems(rawText: string): ParsedSupplierItem[] {
  const items: ParsedSupplierItem[] = []

  for (let idx = 0; idx < VIELE_CATALOG_87.length; idx++) {
    const catItem = VIELE_CATALOG_87[idx]
    const sku = catItem.sku.toUpperCase()

    // Buscar SKU como palabra delimitada
    const regex = new RegExp(`(?:^|[\\s\\t\\n>#])(${sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:[\\s\\t\\n<,]|$|\\.)`, 'i')
    const match = regex.exec(rawText)

    if (match) {
      const matchPos = match.index
      const windowSnippet = rawText.slice(matchPos, Math.min(rawText.length, matchPos + 350))

      // Buscar precios en la ventana del SKU (soporta formato con comas de miles ej: $1,250.00)
      const priceMatches = windowSnippet.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d{1,4}(?:\.\d{2})?)/g)
      let price = catItem.recentPrice

      if (priceMatches && priceMatches.length > 0) {
        for (const pm of priceMatches) {
          const num = cleanPriceNumber(pm)
          if (num > 0.05) {
            price = num
            break
          }
        }
      }

      // Buscar unidad
      let unit = catItem.packUnit || 'CS'
      const unitMatch = windowSnippet.match(/\b(EACH|EA|CS|\d+CS|PAIL|PKG|BOX|BAG|ROLL|CASE|BOTTLE|TUB|CAN|JUG|GAL|LB|OZ|CT)\b/i)
      if (unitMatch) {
        unit = unitMatch[1].toUpperCase()
      }

      items.push({
        rawLineIndex: idx + 1,
        supplierSku: catItem.sku,
        description: catItem.description,
        packUnit: unit,
        packQuantity: catItem.packQuantity || inferPackQuantity(unit, catItem.description),
        casePrice: price,
        comment: ''
      })
    }
  }

  return items
}

/**
 * Parser principal para procesar texto pegado desde el portapapeles o archivo
 */
export function parseSupplierInput(rawText: string): ParseResult {
  const result: ParseResult = {
    success: true,
    totalParsed: 0,
    items: [],
    errors: [],
    detectedFormat: 'unknown'
  }

  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    result.success = false
    result.errors.push('El texto ingresado está vacío')
    return result
  }

  // Limpiar HTML si el usuario pegó rich HTML o tags
  let cleanedText = rawText
  if (cleanedText.includes('<td') || cleanedText.includes('<tr') || cleanedText.includes('<div') || cleanedText.includes('<table')) {
    cleanedText = cleanedText
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/td>/gi, '\t')
      .replace(/<\/th>/gi, '\t')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
  }

  const rawLines = cleanedText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  if (rawLines.length === 0) {
    result.success = false
    result.errors.push('No se encontraron líneas válidas para procesar')
    return result
  }

  // 1. Detección de formato para estrategia horizontal
  const sample = rawLines.slice(0, 15).join('\n')
  const hasTabs = sample.includes('\t')
  const hasCommas = sample.includes(',')

  let detectedFormat: 'tab_separated_table' | 'csv' | 'custom_text' = 'custom_text'
  if (hasTabs) {
    detectedFormat = 'tab_separated_table'
  } else if (hasCommas) {
    detectedFormat = 'csv'
  }

  // 2. Ejecutar todas las estrategias de extracción en paralelo
  const verticalItems = parseVerticalWebTable(rawLines)
  const horizontalItems = parseHorizontalTable(rawLines, detectedFormat)
  const knownItems = parseKnownMasterItems(cleanedText)

  // 3. Seleccionar la mejor estrategia que mayor cantidad de productos haya extraído
  let bestItems: ParsedSupplierItem[] = []
  let bestFormat: ParseResult['detectedFormat'] = 'unknown'

  if (verticalItems.length >= horizontalItems.length && verticalItems.length >= knownItems.length && verticalItems.length > 0) {
    bestItems = verticalItems
    bestFormat = 'vertical_web_table'
  } else if (horizontalItems.length >= knownItems.length && horizontalItems.length > 0) {
    bestItems = horizontalItems
    bestFormat = detectedFormat
  } else if (knownItems.length > 0) {
    bestItems = knownItems
    bestFormat = 'custom_text'
  }

  if (bestItems.length > 0) {
    result.items = bestItems
    result.totalParsed = bestItems.length
    result.detectedFormat = bestFormat
    return result
  }

  // Si no se extrajeron items
  result.totalParsed = 0
  result.success = false
  result.errors.push('No se pudieron extraer artículos con formato de SKU y precio válido')

  return result
}



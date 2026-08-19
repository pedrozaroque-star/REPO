/**
 * @module app/api/inventory/supplier-prices/route
 * @description Endpoint principal del Radar de Precios de Proveedores.
 *   - GET: Obtiene la lista de proveedores, el catálogo de productos mapeados y el historial de variaciones.
 *   - POST: Analiza texto pegado (portapapeles) o archivos CSV/TSV, los compara contra los precios
 *     actuales en base de datos y calcula el semáforo de inflación y el impacto financiero anual ($ USD).
 *
 * @businessRules
 *   - Si el nuevo precio es mayor al precio actual en DB -> estado 'increased' (🔴).
 *   - Si el nuevo precio es menor -> estado 'decreased' (🟢).
 *   - Si el nuevo precio es idéntico -> estado 'unchanged' (⚪).
 *   - Si el SKU no existe en supplier_item_mappings -> estado 'new_sku' (🟡).
 *   - El impacto financiero anual se calcula cruzando la diferencia de precio con el volumen anual promedio de las 15 sucursales.
 *
 * @dataFlow
 *   Frontend (/admin/precios-proveedores) -> POST -> parseSupplierInput -> match con supplier_item_mappings e inventory_items -> Respuesta con Radar Comparativo.
 *
 * @notes
 *   - Protocolo bilingüe (ES/EN) para descripciones y metadatos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { parseSupplierInput, ParsedSupplierItem } from '@/lib/supplier-price-parser'
import { ESTIMATED_ANNUAL_VOLUMES, DEFAULT_ANNUAL_VOLUME } from '@/lib/constants/supplier-volumes'

export const dynamic = 'force-dynamic'

export interface ItemComparisonResult {
  supplierSku: string
  description: string
  packUnit: string
  packQuantity: number
  newCasePrice: number
  newUnitCost: number
  currentCasePrice: number
  currentUnitCost: number
  diffAmount: number
  changePercent: number
  status: 'increased' | 'decreased' | 'unchanged' | 'new_sku' | 'unmapped'
  masterItemId: string | null
  masterItemName: string | null
  masterItemCategory: string | null
  annualEstimatedCases: number
  annualImpactUsd: number
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseAdminClient()

    // 1. Obtener lista de proveedores
    const { data: suppliers, error: supErr } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true })

    if (supErr) throw supErr

    // 2. Obtener historial reciente de cambios de precio (últimos 100 registros)
    const { data: history, error: histErr } = await supabase
      .from('supplier_price_history')
      .select(`
        id,
        supplier_id,
        supplier_sku,
        master_item_id,
        case_price,
        unit_cost,
        previous_unit_cost,
        change_percent,
        effective_date,
        source_type,
        notes,
        created_at,
        suppliers(name, supplier_code),
        inventory_items(name, sku, unit_measure)
      `)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)

    if (histErr) throw histErr

    // 3. Obtener catálogo completo de items mapeados
    const { data: mappings, error: mapErr } = await supabase
      .from('supplier_item_mappings')
      .select(`
        id,
        supplier_id,
        supplier_sku,
        supplier_description,
        pack_quantity,
        pack_unit,
        base_unit,
        is_primary,
        master_item_id,
        inventory_items(id, name, sku, purchase_unit_cost, quantity_per_unit, unit_measure, category_id)
      `)
      .order('supplier_sku', { ascending: true })

    if (mapErr) throw mapErr

    return NextResponse.json({
      success: true,
      suppliers: suppliers || [],
      history: history || [],
      mappings: mappings || []
    })
  } catch (error: any) {
    console.error('[SupplierPricesAPI] GET Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { rawText, supplierId, fileName } = body

    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return NextResponse.json({ success: false, error: 'El contenido de la tabla o archivo está vacío' }, { status: 400 })
    }

    const supabase = await getSupabaseAdminClient()

    // 1. Validar Proveedor
    let targetSupplierId = supplierId
    if (!targetSupplierId) {
      // Default a Viele & Sons
      const { data: defaultSup } = await supabase
        .from('suppliers')
        .select('id')
        .eq('supplier_code', 'VIELE')
        .single()
      targetSupplierId = defaultSup?.id
    }

    if (!targetSupplierId) {
      return NextResponse.json({
        success: false,
        error: 'No se encontró el proveedor seleccionado ni el proveedor por defecto (VIELE). Verifica que existan proveedores registrados.'
      }, { status: 400 })
    }

    // 2. Parsear el texto usando el motor universal
    const parseResult = parseSupplierInput(rawText)
    if (!parseResult.success || parseResult.items.length === 0) {
      return NextResponse.json({
        success: false,
        error: parseResult.errors.join('. ') || 'No se pudieron extraer artículos con formato válido'
      }, { status: 400 })
    }

    // 3. Cargar mapeos existentes para este proveedor
    const { data: existingMappings } = await supabase
      .from('supplier_item_mappings')
      .select(`
        supplier_sku,
        supplier_description,
        pack_quantity,
        pack_unit,
        base_unit,
        master_item_id,
        inventory_items (
          id,
          name,
          sku,
          purchase_unit_cost,
          quantity_per_unit,
          unit_measure,
          inventory_categories (name)
        )
      `)
      .eq('supplier_id', targetSupplierId)

    const mappingMap = new Map<string, any>()
    if (existingMappings) {
      existingMappings.forEach((m: any) => {
        mappingMap.set(m.supplier_sku.toUpperCase(), m)
      })
    }

    // 4. Comparar cada item y calcular variaciones e impacto anual
    const comparisons: ItemComparisonResult[] = []
    let totalIncreases = 0
    let totalDecreases = 0
    let totalUnchanged = 0
    let totalNew = 0
    let netAnnualImpactUsd = 0

    for (const parsed of parseResult.items) {
      const mapping = mappingMap.get(parsed.supplierSku)
      const masterItem = mapping?.inventory_items

      const packQty = mapping?.pack_quantity || parsed.packQuantity || 1
      const packUnit = mapping?.pack_unit || parsed.packUnit || 'CS'
      const newCasePrice = parsed.casePrice
      const newUnitCost = Number((newCasePrice / packQty).toFixed(4))

      let currentCasePrice = 0
      let currentUnitCost = 0
      let masterItemId: string | null = null
      let masterItemName: string | null = null
      let masterItemCategory: string | null = null

      if (masterItem) {
        masterItemId = masterItem.id
        masterItemName = masterItem.name
        masterItemCategory = masterItem.inventory_categories?.name || 'General'
        currentCasePrice = Number(masterItem.purchase_unit_cost) || 0
        currentUnitCost = Number((currentCasePrice / (masterItem.quantity_per_unit || packQty)).toFixed(4))
      }

      let diffAmount = 0
      let changePercent = 0
      let status: ItemComparisonResult['status'] = 'unchanged'

      if (!mapping || !masterItem) {
        status = mapping ? 'unmapped' : 'new_sku'
        totalNew++
      } else if (currentCasePrice <= 0) {
        status = 'new_sku'
        totalNew++
      } else {
        diffAmount = Number((newCasePrice - currentCasePrice).toFixed(2))
        changePercent = Number(((diffAmount / currentCasePrice) * 100).toFixed(2))

        if (diffAmount > 0.009) {
          status = 'increased'
          totalIncreases++
        } else if (diffAmount < -0.009) {
          status = 'decreased'
          totalDecreases++
        } else {
          status = 'unchanged'
          totalUnchanged++
        }
      }

      // Volumen anual estimado (default 200 cajas/año si no está en la tabla histórica)
      const annualEstimatedCases = ESTIMATED_ANNUAL_VOLUMES[parsed.supplierSku] || DEFAULT_ANNUAL_VOLUME
      const annualImpactUsd = Number((diffAmount * annualEstimatedCases).toFixed(2))

      netAnnualImpactUsd += annualImpactUsd

      comparisons.push({
        supplierSku: parsed.supplierSku,
        description: parsed.description || mapping?.supplier_description || '',
        packUnit,
        packQuantity: packQty,
        newCasePrice,
        newUnitCost,
        currentCasePrice,
        currentUnitCost,
        diffAmount,
        changePercent,
        status,
        masterItemId,
        masterItemName,
        masterItemCategory,
        annualEstimatedCases,
        annualImpactUsd
      })
    }

    return NextResponse.json({
      success: true,
      totalParsed: parseResult.totalParsed,
      detectedFormat: parseResult.detectedFormat,
      fileName: fileName || null,
      summary: {
        totalItems: comparisons.length,
        totalIncreases,
        totalDecreases,
        totalUnchanged,
        totalNew,
        netAnnualImpactUsd: Number(netAnnualImpactUsd.toFixed(2))
      },
      items: comparisons
    })
  } catch (error: any) {
    console.error('[SupplierPricesAPI] POST Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

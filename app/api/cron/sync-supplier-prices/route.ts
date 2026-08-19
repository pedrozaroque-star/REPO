/**
 * @module app/api/cron/sync-supplier-prices/route
 * @description Cron job automatizado para sincronización periódica de precios de distribuidores (Viele & Sons).
 *   - Se ejecuta los lunes a las 6:00 AM (inicio de semana laboral).
 *   - Conecta a la API del portal de Viele & Sons y extrae el catálogo de precios vigentes.
 *   - Compara los costos contra los insumos maestros en Supabase.
 *   - Si detecta aumentos o reducciones de precio, registra auditoría inmutable en supplier_price_history.
 *
 * @businessRules
 *   - Autentica con credenciales corporativas (VIELE_PORTAL_USER / VIELE_PORTAL_PASS).
 *   - Si diffAmount != 0, registra un nuevo evento histórico en supplier_price_history con source_type 'cron_sync'.
 *   - Invalida el caché de Food Cost de los últimos 7 días si se aprueban o detectan aumentos críticos.
 *
 * @dataFlow
 *   Vercel Cron -> GET / POST -> syncVielePortalDirect -> Comparación con inventory_items -> supplier_price_history.
 *
 * @notes
 *   - Seguro para ejecución desatendida en Vercel Serverless con Vercel Cron.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { syncVielePortalDirect } from '@/lib/vendor-scraper'
import { ESTIMATED_ANNUAL_VOLUMES, DEFAULT_ANNUAL_VOLUME } from '@/lib/constants/supplier-volumes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handleSync(request: NextRequest) {
  // Validar CRON_SECRET para proteger contra invocaciones no autorizadas
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  console.log('[Cron:SyncSupplierPrices] 🚀 Iniciando sincronización de precios de proveedores...')

  try {
    // 1. Ejecutar sincronización directa con Viele & Sons
    const scrapeResult = await syncVielePortalDirect()

    if (!scrapeResult.success || scrapeResult.items.length === 0) {
      console.error('[Cron:SyncSupplierPrices] ❌ Error en el scraper:', scrapeResult.errorMessage)
      return NextResponse.json({
        success: false,
        error: scrapeResult.errorMessage || 'Error en sincronización con Viele & Sons'
      }, { status: 500 })
    }

    const supabase = await getSupabaseAdminClient()

    // 2. Obtener ID del proveedor Viele
    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id, name, supplier_code')
      .eq('supplier_code', 'VIELE')
      .single()

    const supplierId = supplier?.id
    if (!supplierId) {
      return NextResponse.json({ success: false, error: 'Proveedor VIELE no encontrado en base de datos' }, { status: 404 })
    }

    // 3. Cargar mapeos existentes con inventory_items
    const { data: mappings } = await supabase
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
          purchase_unit_cost,
          quantity_per_unit
        )
      `)
      .eq('supplier_id', supplierId)

    const mappingMap = new Map<string, any>()
    if (mappings) {
      mappings.forEach((m: any) => {
        mappingMap.set(m.supplier_sku.toUpperCase(), m)
      })
    }

    // 4. Obtener historial reciente del cron para evitar duplicados (idempotencia)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const { data: recentCronHistory } = await supabase
      .from('supplier_price_history')
      .select('supplier_sku, case_price')
      .eq('supplier_id', supplierId)
      .eq('source_type', 'cron_sync')
      .gte('effective_date', sevenDaysAgo)

    const recentCronSet = new Set<string>()
    if (recentCronHistory) {
      recentCronHistory.forEach((h: any) => {
        recentCronSet.add(`${h.supplier_sku}|${Number(h.case_price).toFixed(2)}`)
      })
    }

    // 5. Analizar variaciones
    let totalIncreases = 0
    let totalDecreases = 0
    let totalUnchanged = 0
    let totalNew = 0
    let totalSkippedDuplicates = 0
    let netAnnualImpactUsd = 0
    const historyInserts: any[] = []
    const todayStr = new Date().toISOString().split('T')[0]

    for (const parsed of scrapeResult.items) {
      const mapping = mappingMap.get(parsed.supplierSku)
      const masterItem = mapping?.inventory_items
      const packQty = mapping?.pack_quantity || parsed.packQuantity || 1
      const newCasePrice = parsed.casePrice
      const newUnitCost = Number((newCasePrice / packQty).toFixed(4))

      let currentCasePrice = 0
      let currentUnitCost = 0
      let masterItemId = masterItem?.id || null

      if (masterItem) {
        currentCasePrice = Number(masterItem.purchase_unit_cost) || 0
        currentUnitCost = Number((currentCasePrice / (masterItem.quantity_per_unit || packQty)).toFixed(4))
      }

      const diffAmount = Number((newCasePrice - currentCasePrice).toFixed(2))
      const changePercent = currentCasePrice > 0 ? Number(((diffAmount / currentCasePrice) * 100).toFixed(2)) : 0

      if (!mapping || !masterItem || currentCasePrice <= 0) {
        totalNew++
      } else if (diffAmount > 0.009) {
        totalIncreases++
        const annualVol = ESTIMATED_ANNUAL_VOLUMES[parsed.supplierSku] || DEFAULT_ANNUAL_VOLUME
        netAnnualImpactUsd += diffAmount * annualVol

        // Idempotencia: no insertar si ya existe un registro cron reciente con el mismo SKU y precio
        const dedupeKey = `${parsed.supplierSku}|${newCasePrice.toFixed(2)}`
        if (recentCronSet.has(dedupeKey)) {
          totalSkippedDuplicates++
        } else {
          historyInserts.push({
            supplier_id: supplierId,
            supplier_sku: parsed.supplierSku,
            master_item_id: masterItemId,
            case_price: newCasePrice,
            unit_cost: newUnitCost,
            previous_unit_cost: currentCasePrice,
            change_percent: changePercent,
            effective_date: todayStr,
            source_type: 'cron_sync',
            notes: `Detectado aumento de $${diffAmount.toFixed(2)} (+${changePercent}%) en cron semanal.`,
            created_by: 'Cron System'
          })
        }
      } else if (diffAmount < -0.009) {
        totalDecreases++
        const annualVol = ESTIMATED_ANNUAL_VOLUMES[parsed.supplierSku] || DEFAULT_ANNUAL_VOLUME
        netAnnualImpactUsd += diffAmount * annualVol

        const dedupeKey = `${parsed.supplierSku}|${newCasePrice.toFixed(2)}`
        if (recentCronSet.has(dedupeKey)) {
          totalSkippedDuplicates++
        } else {
          historyInserts.push({
            supplier_id: supplierId,
            supplier_sku: parsed.supplierSku,
            master_item_id: masterItemId,
            case_price: newCasePrice,
            unit_cost: newUnitCost,
            previous_unit_cost: currentCasePrice,
            change_percent: changePercent,
            effective_date: todayStr,
            source_type: 'cron_sync',
            notes: `Detectada reducción de $${Math.abs(diffAmount).toFixed(2)} (${changePercent}%) en cron semanal.`,
            created_by: 'Cron System'
          })
        }
      } else {
        totalUnchanged++
      }
    }

    // 6. Guardar historial si hubo variaciones NUEVAS (no duplicadas)
    if (historyInserts.length > 0) {
      await supabase.from('supplier_price_history').insert(historyInserts)
      console.log(`[Cron:SyncSupplierPrices] ✅ ${historyInserts.length} variaciones NUEVAS registradas (${totalSkippedDuplicates} duplicados omitidos).`)
    } else if (totalSkippedDuplicates > 0) {
      console.log(`[Cron:SyncSupplierPrices] ℹ️ ${totalSkippedDuplicates} variaciones ya registradas previamente, sin duplicados insertados.`)
    }

    const durationMs = Date.now() - startTime
    console.log(`[Cron:SyncSupplierPrices] ✅ Sincronización completada en ${durationMs}ms: ${scrapeResult.totalItems} items (${totalIncreases} aumentos, ${totalDecreases} reducciones, ${totalUnchanged} sin cambio).`)

    return NextResponse.json({
      success: true,
      supplierCode: 'VIELE',
      itemsScraped: scrapeResult.totalItems,
      totalIncreases,
      totalDecreases,
      totalUnchanged,
      totalNew,
      netAnnualImpactUsd: Number(netAnnualImpactUsd.toFixed(2)),
      historyRecordsCreated: historyInserts.length,
      durationMs
    })
  } catch (error: any) {
    console.error('[Cron:SyncSupplierPrices] ❌ Excepción no controlada:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Error en el cron de precios' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handleSync(request)
}

export async function POST(request: NextRequest) {
  return handleSync(request)
}

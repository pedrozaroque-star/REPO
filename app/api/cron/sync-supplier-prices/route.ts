/**
 * @module app/api/cron/sync-supplier-prices/route
 * @description Cron job automatizado para sincronización periódica de precios de distribuidores (Viele & Sons).
 *   - Se ejecuta de lunes a viernes a las 6:00 AM PST (inicio de cada día laboral, 5 veces por semana).
 *   - Conecta a la API del portal de Viele & Sons y extrae el catálogo de precios vigentes.
 *   - Compara los costos contra los insumos maestros en Supabase.
 *   - AUTO-APRUEBA los precios detectados en inventory_items.purchase_unit_cost porque el proveedor
 *     YA cobra esos precios en la siguiente orden (no es una propuesta sino un hecho).
 *   - Invalida el caché de Food Cost para recalcular con precios reales.
 *   - Despacha correo INFORMATIVO a directivos con el desglose de variaciones.
 *
 * @businessRules
 *   - Autentica con credenciales corporativas (VIELE_PORTAL_USER / VIELE_PORTAL_PASS).
 *   - Si diffAmount != 0, registra historial inmutable (source_type 'cron_sync') y auto-aprueba.
 *   - El correo es informativo, no requiere acción manual para aprobar precios.
 *   - Invalida caché de food_cost_daily_cache de los últimos 7 días tras auto-aprobación.
 *
 * @dataFlow
 *   Vercel Cron -> GET/POST -> syncVielePortalDirect -> Comparación -> supplier_price_history
 *   -> Auto-aprueba inventory_items -> Invalida food_cost_daily_cache -> Email informativo.
 *
 * @notes
 *   - Seguro para ejecución desatendida en Vercel Serverless con Vercel Cron.
 *   - QuickBooks sync tiene blindaje is_bodega para NO pisar estos precios externos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { syncVielePortalDirect } from '@/lib/vendor-scraper'
import { ESTIMATED_ANNUAL_VOLUMES, DEFAULT_ANNUAL_VOLUME } from '@/lib/constants/supplier-volumes'
import { sendSupplierPriceAlertEmail, PriceIncreaseItem } from '@/lib/supplier-price-email'

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
          quantity_per_unit,
          updated_at
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
    const increasesForEmail: PriceIncreaseItem[] = []
    const decreasesForEmail: PriceIncreaseItem[] = []
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
        const annualImpact = diffAmount * annualVol
        netAnnualImpactUsd += annualImpact

        increasesForEmail.push({
          supplierSku: parsed.supplierSku,
          description: mapping?.supplier_description || parsed.description || masterItem.name,
          packUnit: mapping?.pack_unit || parsed.packUnit,
          packQuantity: packQty,
          previousCasePrice: currentCasePrice,
          newCasePrice: newCasePrice,
          diffAmount,
          changePercent,
          annualVolume: annualVol,
          annualImpactUsd: Number(annualImpact.toFixed(2)),
          lastApprovedDate: masterItem.updated_at || undefined
        })

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
        const annualImpact = diffAmount * annualVol
        netAnnualImpactUsd += annualImpact

        decreasesForEmail.push({
          supplierSku: parsed.supplierSku,
          description: mapping?.supplier_description || parsed.description || masterItem.name,
          packUnit: mapping?.pack_unit || parsed.packUnit,
          packQuantity: packQty,
          previousCasePrice: currentCasePrice,
          newCasePrice: newCasePrice,
          diffAmount,
          changePercent,
          annualVolume: annualVol,
          annualImpactUsd: Number(annualImpact.toFixed(2)),
          lastApprovedDate: masterItem.updated_at || undefined
        })

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
      const { error: insertErr } = await supabase.from('supplier_price_history').insert(historyInserts)
      if (insertErr) {
        console.error(`[Cron:SyncSupplierPrices] ⚠️ Error al insertar historial: ${insertErr.message}`)
      } else {
        console.log(`[Cron:SyncSupplierPrices] ✅ ${historyInserts.length} variaciones NUEVAS registradas (${totalSkippedDuplicates} duplicados omitidos).`)
      }
    } else if (totalSkippedDuplicates > 0) {
      console.log(`[Cron:SyncSupplierPrices] ℹ️ ${totalSkippedDuplicates} variaciones ya registradas previamente, sin duplicados insertados.`)
    }

    // 6.5. AUTO-APROBACIÓN: Actualizar inventory_items.purchase_unit_cost con el precio real de Viele.
    // REGLA DE NEGOCIO: Viele & Sons ya cobra estos precios en la siguiente orden,
    // no es una propuesta que requiere autorización. El correo es INFORMATIVO, no de aprobación.
    // Esto garantiza que Food Cost, recetas y reportes financieros reflejen la realidad.
    let autoApprovedCount = 0
    const nowIso = new Date().toISOString()
    const inventoryHistoryInserts: any[] = []

    for (const parsed of scrapeResult.items) {
      const mapping = mappingMap.get(parsed.supplierSku)
      const masterItem = mapping?.inventory_items
      if (!mapping || !masterItem?.id) continue

      const currentCasePrice = Number(masterItem.purchase_unit_cost) || 0
      const newCasePrice = parsed.casePrice
      const diff = Number((newCasePrice - currentCasePrice).toFixed(2))

      if (Math.abs(diff) > 0.009 && newCasePrice > 0) {
        const packQtyNum = Number(mapping.pack_quantity) || 1
        const { error: updateErr } = await supabase
          .from('inventory_items')
          .update({
            purchase_unit_cost: newCasePrice,
            updated_at: nowIso
          })
          .eq('id', masterItem.id)

        if (!updateErr) {
          autoApprovedCount++
          // Registrar en inventory_price_history para "La Máquina del Tiempo" de Food Cost
          // Esto garantiza que cualquier reporte de fechas pasadas use el costo que estaba vigente en ese momento.
          inventoryHistoryInserts.push({
            inventory_item_id: masterItem.id,
            purchase_unit_cost: newCasePrice,
            quantity_per_unit: packQtyNum,
            effective_date: nowIso
          })
        }
      }
    }

    if (inventoryHistoryInserts.length > 0) {
      await supabase.from('inventory_price_history').insert(inventoryHistoryInserts)
      console.log(`[Cron:SyncSupplierPrices] 🕰️ ${inventoryHistoryInserts.length} registros guardados en inventory_price_history para auditoría histórica de Food Cost.`)
    }

    if (autoApprovedCount > 0) {
      console.log(`[Cron:SyncSupplierPrices] ✅ Auto-aprobados ${autoApprovedCount} precios en inventory_items (reflejan costo real del proveedor).`)

      // Invalidar caché de Food Cost del día de hoy en adelante para recalcular con precios actualizados
      // Las fechas anteriores quedan INTACTAS con sus costos históricos reales.
      const todayStr = new Date().toISOString().split('T')[0]
      await supabase.from('food_cost_daily_cache').delete().gte('business_date', todayStr)
      console.log(`[Cron:SyncSupplierPrices] 🗑️ Caché de Food Cost invalidado a partir de ${todayStr} para recálculo. Fechas pasadas permanecen intactas.`)
    }

    // 7. Enviar Alerta por Correo a Directivos si se detectaron variaciones (Aumentos o Rebajas de Precio)
    let emailAlertSent = false
    let emailMessageId: string | undefined
    if (increasesForEmail.length > 0 || decreasesForEmail.length > 0) {
      console.log(`[Cron:SyncSupplierPrices] 📧 Enviando alerta de precios (${increasesForEmail.length} aumentos, ${decreasesForEmail.length} rebajas) a la directiva...`)
      const emailResult = await sendSupplierPriceAlertEmail({
        supplierName: 'Viele & Sons',
        supplierCode: 'VIELE',
        detectedAt: new Date(),
        sourceType: 'cron_auto',
        increases: increasesForEmail,
        decreases: decreasesForEmail,
        netAnnualImpactUsd
      })
      emailAlertSent = emailResult.success
      emailMessageId = emailResult.messageId
    }

    const durationMs = Date.now() - startTime
    console.log(`[Cron:SyncSupplierPrices] ✅ Sincronización completada en ${durationMs}ms: ${scrapeResult.totalItems} items (${totalIncreases} aumentos, ${totalDecreases} reducciones, ${totalUnchanged} sin cambio, ${autoApprovedCount} auto-aprobados). Email enviado: ${emailAlertSent}`)

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
      autoApprovedCount,
      emailAlertSent,
      emailMessageId,
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

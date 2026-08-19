/**
 * @module app/api/inventory/supplier-prices/approve/route
 * @description Endpoint de aprobación y actualización en cascada de precios de proveedores.
 *   Aplica los nuevos precios por caja a `inventory_items`, registra la auditoría histórica
 *   en `supplier_price_history`, y purga el caché de Food Cost para recálculo inmediato.
 *
 * @businessRules
 *   - Solo los usuarios autorizados (administradores/supervisores) pueden aplicar cambios masivos de precio.
 *   - Cada cambio de precio genera una fila inmutable en `supplier_price_history`.
 *   - Al aprobar, se invalida el caché de Food Cost de los últimos 7 días para reflejar el nuevo costo unitario.
 *
 * @dataFlow
 *   Frontend (Aprobar en Radar) -> POST /approve -> Update inventory_items
 *   -> Insert inventory_price_history ("Máquina del Tiempo" de Food Cost)
 *   -> Insert supplier_price_history (auditoría de proveedores)
 *   -> Purge food_cost_daily_cache.
 *
 * @notes
 *   - BUG FIX (2026-08-18): Se agrega inserción en `inventory_price_history` para que
 *     "La Máquina del Tiempo" de Food Cost use el precio recién aprobado y no el viejo de QB.
 *   - previous_unit_cost siempre almacena el costo por CAJA (case_price), no el unitario,
 *     para mantener consistencia con el cron semanal.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { approvedItems, supplierId, sourceType = 'clipboard', approvedBy = 'Admin' } = body

    if (!Array.isArray(approvedItems) || approvedItems.length === 0) {
      return NextResponse.json({ success: false, error: 'No se enviaron artículos para aprobar' }, { status: 400 })
    }

    const supabase = await getSupabaseAdminClient()
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]

    let updatedCount = 0
    let historyCount = 0
    const errors: string[] = []

    for (const item of approvedItems) {
      const {
        supplierSku,
        description,
        packQuantity = 1,
        packUnit = 'CS',
        newCasePrice,
        currentCasePrice = 0,
        masterItemId
      } = item

      if (!supplierSku || newCasePrice === undefined || newCasePrice === null) {
        continue
      }

      const casePriceNum = Number(newCasePrice)
      const packQtyNum = Number(packQuantity) || 1

      // Bug 10 fix: validar que el precio no sea NaN ni negativo
      if (isNaN(casePriceNum) || casePriceNum <= 0) {
        errors.push(`SKU ${supplierSku}: precio inválido (${newCasePrice})`)
        continue
      }

      const unitCostNum = Number((casePriceNum / packQtyNum).toFixed(4))

      let targetMasterId = masterItemId

      // Bug 9 fix: leer el precio ACTUAL de la DB en vez de confiar en el frontend (puede ser stale)
      let realCurrentCasePrice = Number(currentCasePrice)
      if (targetMasterId) {
        const { data: currentItem } = await supabase
          .from('inventory_items')
          .select('purchase_unit_cost')
          .eq('id', targetMasterId)
          .single()
        if (currentItem) {
          realCurrentCasePrice = Number(currentItem.purchase_unit_cost) || 0
        }
      }

      const diffAmount = casePriceNum - realCurrentCasePrice
      const changePct = realCurrentCasePrice > 0 ? Number(((diffAmount / realCurrentCasePrice) * 100).toFixed(2)) : 0

      // 1. Si tiene masterItemId, actualizar inventory_items
      if (targetMasterId) {
        const { error: invErr } = await supabase
          .from('inventory_items')
          .update({
            purchase_unit_cost: casePriceNum,
            quantity_per_unit: packQtyNum,
            unit_type: packUnit,
            updated_at: now.toISOString()
          })
          .eq('id', targetMasterId)

        if (invErr) {
          errors.push(`Error al actualizar inventario para SKU ${supplierSku}: ${invErr.message}`)
        } else {
          updatedCount++

          // 1.5 CRITICAL: Insertar en inventory_price_history para "La Máquina del Tiempo" de Food Cost.
          // Sin esto, food-cost/route.ts usa precios viejos de QB en lugar de los recién aprobados.
          await supabase
            .from('inventory_price_history')
            .insert({
              inventory_item_id: targetMasterId,
              purchase_unit_cost: casePriceNum,
              quantity_per_unit: packQtyNum,
              effective_date: now.toISOString()
            })
        }
      }

      // 2. Actualizar o crear mapping
      if (supplierId && targetMasterId) {
        await supabase
          .from('supplier_item_mappings')
          .upsert({
            supplier_id: supplierId,
            supplier_sku: supplierSku,
            supplier_description: description || supplierSku,
            master_item_id: targetMasterId,
            pack_quantity: packQtyNum,
            pack_unit: packUnit,
            updated_at: now.toISOString()
          }, { onConflict: 'supplier_id,supplier_sku' })
      }

      // 3. Registrar en supplier_price_history (auditoría de proveedor)
      if (supplierId) {
        const { error: histErr } = await supabase
          .from('supplier_price_history')
          .insert({
            supplier_id: supplierId,
            supplier_sku: supplierSku,
            master_item_id: targetMasterId || null,
            case_price: casePriceNum,
            unit_cost: unitCostNum,
            previous_unit_cost: realCurrentCasePrice,
            change_percent: changePct,
            effective_date: todayStr,
            source_type: sourceType,
            notes: `Aprobado por ${approvedBy} desde Radar de Precios`,
            created_by: approvedBy
          })

        if (!histErr) historyCount++
      }
    }

    // 4. Invalidar caché de Food Cost de los últimos 7 días para forzar recálculo
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await supabase
      .from('food_cost_daily_cache')
      .delete()
      .gte('business_date', sevenDaysAgo)

    return NextResponse.json({
      success: true,
      updatedInventoryItems: updatedCount,
      historyRecordsCreated: historyCount,
      cachePurgedFrom: sevenDaysAgo,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error: any) {
    console.error('[SupplierPricesApproveAPI] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

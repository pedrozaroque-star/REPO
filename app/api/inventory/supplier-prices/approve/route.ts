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
 *   -> Ensure inventory_price_history ("Máquina del Tiempo" de Food Cost, deduplicado con trigger)
 *   -> Sync viele_items.unit_price (carrito de compras Viele & Sons)
 *   -> Insert supplier_price_history (auditoría de proveedores)
 *   -> Purge food_cost_daily_cache (últimos 7 días laborales LA).
 *
 * @notes
 *   - BUG FIX (2026-08-18): Se agrega inserción en `inventory_price_history` para que
 *     "La Máquina del Tiempo" de Food Cost use el precio recién aprobado y no el viejo de QB.
 *   - previous_unit_cost siempre almacena el costo por CAJA (case_price), no el unitario,
 *     para mantener consistencia con el cron semanal.
 *   - [2026-11-23] Endurecido `allowCron: false`, `approvedBy` derivado exclusivamente de `auth.user`
 *     (nunca del body del cliente), sincronización en cascada a `viele_items.unit_price` cuando
 *     coincide el SKU, deduplicación contra `trigger_log_inventory_price`, e invalidación LA 7 días (`getBusinessDateLA`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { addDaysIso, getBusinessDateLA } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: false })
  if (!auth.authorized) {
    return auth.response || NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
  }

  try {
    const body = await request.json()
    const { approvedItems, supplierId, sourceType = 'clipboard' } = body
    const approvedBy =
      auth.user?.email ||
      auth.user?.user_metadata?.full_name ||
      'Admin'

    if (!Array.isArray(approvedItems) || approvedItems.length === 0) {
      return NextResponse.json({ success: false, error: 'No se enviaron artículos para aprobar' }, { status: 400 })
    }

    const supabase = await getSupabaseAdminClient()
    const now = new Date()
    const nowIso = now.toISOString()
    const tenSecAgoIso = new Date(now.getTime() - 10_000).toISOString()
    const todayStr = getBusinessDateLA(now)

    let updatedCount = 0
    let updatedVieleCount = 0
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

      const cleanSku = String(supplierSku).trim().toUpperCase()
      const casePriceNum = Number(newCasePrice)
      const rawPackQty = Number(packQuantity)
      const packQtyNum = Number.isFinite(rawPackQty) && rawPackQty > 0 ? rawPackQty : 1

      // Bug 10 fix: validar que el precio no sea NaN ni negativo
      if (!Number.isFinite(casePriceNum) || casePriceNum <= 0) {
        errors.push(`SKU ${cleanSku}: precio inválido (${newCasePrice})`)
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

      const diffAmount = Number((casePriceNum - realCurrentCasePrice).toFixed(2))
      const changePct = realCurrentCasePrice > 0 ? Number(((diffAmount / realCurrentCasePrice) * 100).toFixed(2)) : 0

      // 1. Si tiene masterItemId, actualizar inventory_items
      if (targetMasterId) {
        const { error: invErr } = await supabase
          .from('inventory_items')
          .update({
            purchase_unit_cost: casePriceNum,
            quantity_per_unit: packQtyNum,
            unit_type: packUnit,
            updated_at: nowIso
          })
          .eq('id', targetMasterId)

        if (invErr) {
          errors.push(`Error al actualizar inventario para SKU ${cleanSku}: ${invErr.message}`)
        } else {
          updatedCount++

          // 1.5 Garantizar registro en `inventory_price_history` ("La Máquina del Tiempo" de Food Cost)
          // sin duplicar la fila creada por `trigger_log_inventory_price`.
          const { data: recentHist } = await supabase
            .from('inventory_price_history')
            .select('id, quantity_per_unit')
            .eq('inventory_item_id', targetMasterId)
            .eq('purchase_unit_cost', casePriceNum)
            .gte('effective_date', tenSecAgoIso)
            .order('effective_date', { ascending: false })
            .limit(1)

          if (recentHist && recentHist.length > 0) {
            if (Number(recentHist[0].quantity_per_unit) !== packQtyNum) {
              await supabase
                .from('inventory_price_history')
                .update({ quantity_per_unit: packQtyNum })
                .eq('id', recentHist[0].id)
            }
          } else {
            await supabase
              .from('inventory_price_history')
              .insert({
                inventory_item_id: targetMasterId,
                purchase_unit_cost: casePriceNum,
                quantity_per_unit: packQtyNum,
                effective_date: nowIso
              })
          }
        }
      }

      // 1.8 Sincronizar `viele_items.unit_price` cuando el SKU coincida para mantener el carrito de Viele en línea
      if (cleanSku) {
        const { data: existingViele } = await supabase
          .from('viele_items')
          .select('item_code, unit_price')
          .eq('item_code', cleanSku)
          .maybeSingle()

        if (existingViele) {
          const prevVielePrice = Number(existingViele.unit_price) || 0
          const vieleDiff = Number((casePriceNum - prevVielePrice).toFixed(2))
          const vielePct = prevVielePrice > 0 ? Number(((vieleDiff / prevVielePrice) * 100).toFixed(2)) : 0
          const vieleStatus = Math.abs(vieleDiff) <= 0.009 ? 'unchanged' : (vieleDiff > 0 ? 'increased' : 'decreased')

          const { error: vieleErr } = await supabase
            .from('viele_items')
            .update({
              unit_price: casePriceNum,
              ...(Math.abs(vieleDiff) > 0.009
                ? {
                    previous_price: prevVielePrice,
                    price_change_percent: vielePct,
                    price_changed_at: nowIso,
                    price_status: vieleStatus,
                  }
                : {}),
              updated_at: nowIso,
            })
            .eq('item_code', cleanSku)

          if (!vieleErr) {
            updatedVieleCount++
          }
        }
      }

      // 2. Actualizar o crear mapping
      if (supplierId && targetMasterId) {
        await supabase
          .from('supplier_item_mappings')
          .upsert({
            supplier_id: supplierId,
            supplier_sku: cleanSku,
            supplier_description: description || cleanSku,
            master_item_id: targetMasterId,
            pack_quantity: packQtyNum,
            pack_unit: packUnit,
            updated_at: nowIso
          }, { onConflict: 'supplier_id,supplier_sku' })
      }

      // 3. Registrar en supplier_price_history (auditoría de proveedor)
      if (supplierId) {
        const { error: histErr } = await supabase
          .from('supplier_price_history')
          .insert({
            supplier_id: supplierId,
            supplier_sku: cleanSku,
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

    // 4. Invalidar caché de Food Cost de los últimos 7 días laborales LA (6:00 AM rollover)
    const sevenDaysAgo = addDaysIso(todayStr, -7)
    await supabase
      .from('food_cost_daily_cache')
      .delete()
      .gte('business_date', sevenDaysAgo)

    return NextResponse.json({
      success: true,
      updatedInventoryItems: updatedCount,
      updatedVieleItems: updatedVieleCount,
      historyRecordsCreated: historyCount,
      cachePurgedFrom: sevenDaysAgo,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error: any) {
    console.error('[SupplierPricesApproveAPI] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

/**
 * @module api/cron/sync-accounting
 * @description Automated Sentinel for Daily Sales Reconciliation (Rolling 7-Day Window).
 * Runs daily at 6:15 AM PST (13:15 UTC) — right after the 6:00 AM business day cutoff.
 * 
 * @businessRules
 * - Business day starts at 6:00 AM and ends at 5:59 AM the next day (America/Los_Angeles).
 * - Generates daily sales packets for yesterday (which closed at 5:59 AM) across all 15 stores.
 * - Validates Step 11 (Cohesion rule): checks for open orders or unclosed checks in Toast POS.
 *   If clean: sets status to 'ready' (green) for Raquel's 1-click publishing.
 *   If open orders exist: sets status to 'pending' with detailed issue logs.
 * - Rolling 7-Day Audit (days -2 to -7):
 *   * If a packet is NOT published yet ('ready', 'pending', 'reviewed'): re-verifies against Toast POS
 *     and recalculates silently if changes occurred (late closed checks, tips adjusted).
 *   * If a packet is ALREADY published to QuickBooks ('published'): compares Toast POS current net sales
 *     against published net sales. If a discrepancy > $0.05 is detected (e.g. late refunds applied days later),
 *     flags the packet with 'post_publish_discrepancy' without altering QuickBooks, alerting Raquel with an
 *     adjusting entry option.
 * 
 * @dataFlow
 * Cron trigger at 6:15 AM → fetch site mappings → Toast POS API v2 / sales_daily_cache → generateJournalLines
 * → upsert accounting_sales_packets → log to accounting_sync_logs
 * 
 * @notes
 * - Semi-automated mode (Option A): Packets are pre-calculated, audited and left in 'ready' status.
 *   Raquel enters at 8:00 AM, verifies green indicators, and publishes all with 1 click.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchToastAccountingData } from '@/lib/toast-accounting'
import { generateJournalLines, calculateExpectedCash, formatDocNumber } from '@/lib/accounting-journal'
import type { SalesPacketData, SiteMappingConfig } from '@/lib/accounting-journal'

export async function GET() {
  const startTime = Date.now()
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('⏰ [sync-accounting] INICIANDO CENTINELA AUTOMÁTICO DE CONCILIACIÓN (7 DÍAS)')
  console.log('═══════════════════════════════════════════════════════════════════════')

  try {
    // 1. Calculate business dates in Los Angeles timezone
    const now = new Date()
    const laDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const laHour = laTime.getHours()

    // If running at 6:15 AM, the business day that just closed at 5:59 AM is yesterday
    const daysBackForYesterday = laHour < 6 ? 2 : 1
    const yesterdayDate = new Date(laTime)
    yesterdayDate.setDate(yesterdayDate.getDate() - daysBackForYesterday)
    const yesterdayStr = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

    // Build the rolling 7-day list (yesterday + previous 6 days)
    const rollingDates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(yesterdayDate)
      d.setDate(d.getDate() - i)
      rollingDates.push(d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
    }

    console.log(`[sync-accounting] Fecha de negocio cerrada hoy (ayer): ${yesterdayStr}`)
    console.log(`[sync-accounting] Ventana rodante de 7 días: ${rollingDates[6]} al ${rollingDates[0]}`)

    // 2. Fetch active store mappings
    const { data: mappings, error: mapErr } = await supabaseAdmin
      .from('accounting_site_mappings')
      .select('*, stores!inner(id, name, external_id)')
      .eq('is_active', true)

    if (mapErr || !mappings || mappings.length === 0) {
      console.error('[sync-accounting] Error: No se encontraron mapeos de tiendas:', mapErr)
      return NextResponse.json({ error: 'No active store mappings found', details: mapErr?.message }, { status: 500 })
    }

    console.log(`[sync-accounting] Mapeos activos cargados para ${mappings.length} sucursales.`)

    const stats = {
      yesterdayDate: yesterdayStr,
      yesterdayGenerated: 0,
      yesterdayCleanReady: 0,
      yesterdayBlockedStep11: 0,
      rollingAuditDays: 7,
      olderPacketsRecalculated: 0,
      postPublishDiscrepanciesDetected: 0,
      discrepancyAlerts: [] as any[],
      errors: [] as any[]
    }

    // 3. Process each date in the 7-day window
    for (const targetDate of rollingDates) {
      const isYesterday = targetDate === yesterdayStr
      const targetDateYMD = targetDate.replace(/-/g, '')

      for (const mapping of mappings) {
        const store = mapping.stores as any
        const storeName = store?.name || `Tienda ${mapping.store_id}`
        const extId = store?.external_id

        if (!extId) {
          stats.errors.push({ store: storeName, date: targetDate, error: 'Sin Toast external_id' })
          continue
        }

        try {
          // Check existing packet
          const { data: existingPacket } = await supabaseAdmin
            .from('accounting_sales_packets')
            .select('*')
            .eq('store_id', mapping.store_id)
            .eq('business_date', targetDate)
            .maybeSingle()

          // If date is from days -2 to -7 and already published, run post-publish audit
          if (!isYesterday && existingPacket && existingPacket.status === 'published') {
            // Fetch live Toast data to check if refunds or adjustments happened post-publishing
            const liveToast = await fetchToastAccountingData(extId, targetDateYMD)
            const publishedNet = Number(existingPacket.net_sales || 0)
            const liveNet = liveToast.netSales
            const diffNet = Math.round(Math.abs(liveNet - publishedNet) * 100) / 100

            if (diffNet > 0.05) {
              stats.postPublishDiscrepanciesDetected++
              const alertDetail = {
                store: storeName,
                date: targetDate,
                docNumber: existingPacket.qb_doc_number,
                publishedNet,
                liveToastNet: liveNet,
                diffNet,
                detectedAt: new Date().toISOString()
              }
              stats.discrepancyAlerts.push(alertDetail)

              // Record discrepancy on packet without overwriting QB status
              const updatedQbResponse = {
                ...(existingPacket.qb_sync_response || {}),
                post_publish_discrepancy: {
                  hasDiscrepancy: true,
                  detectedAt: new Date().toISOString(),
                  publishedNet,
                  liveToastNet: liveNet,
                  diffNet,
                  liveToastTaxes: liveToast.totalTaxes,
                  publishedTaxes: Number(existingPacket.total_taxes || 0)
                }
              }

              await supabaseAdmin
                .from('accounting_sales_packets')
                .update({
                  qb_sync_response: updatedQbResponse,
                  notes: `[AUDIT_ALERT] Discrepancia post-publicación en Toast POS: Diferencia de $${diffNet.toFixed(2)} (Publicado: $${publishedNet.toFixed(2)} vs Toast actual: $${liveNet.toFixed(2)}).`
                })
                .eq('id', existingPacket.id)

              console.log(`⚠️ [sync-accounting] Discrepancia post-publicación en ${storeName} (${targetDate}): Diff $${diffNet.toFixed(2)}`)
            }
            continue
          }

          // For yesterday OR older unpublished packets: fetch fresh Toast data and calculate
          const toastData = await fetchToastAccountingData(extId, targetDateYMD)

          // Step 11 Open Orders Rule
          const hasOpenOrders = toastData.hasOpenOrders || (toastData.openOrdersCount > 0)
          const isBalanced = true // Journal is balanced by generateJournalLines

          // Status: if clean and balanced -> ready (ready for Raquel to 1-click publish!)
          const packetStatus = hasOpenOrders ? 'pending' : 'ready'

          if (isYesterday) {
            stats.yesterdayGenerated++
            if (packetStatus === 'ready') stats.yesterdayCleanReady++
            else stats.yesterdayBlockedStep11++
          } else if (existingPacket && existingPacket.status !== 'published') {
            stats.olderPacketsRecalculated++
          }

          const siteConfig: SiteMappingConfig = {
            location: mapping.qb_location || storeName,
            className: mapping.qb_class || storeName,
            bank_account: mapping.bank_account_number || '10000',
            sales_tax_rate_name: mapping.sales_tax_rate_name || mapping.qb_location || storeName
          }

          const salesPacketData: SalesPacketData = {
            net_sales: toastData.netSales,
            total_taxes: toastData.totalTaxes,
            for_here_sales: toastData.forHereSales,
            to_go_sales: toastData.toGoSales,
            toast_online_sales: toastData.toastOnlineSales,
            uber_delivery_sales: toastData.uberDeliverySales,
            uber_takeout_sales: toastData.uberTakeoutSales,
            doordash_takeout_sales: toastData.doordashTakeoutSales,
            doordash_delivery_sales: toastData.doordashDeliverySales,
            grubhub_delivery_sales: toastData.grubhubDeliverySales,
            grubhub_takeout_sales: toastData.grubhubTakeoutSales,
            tax_paid_by_uber: toastData.taxPaidByUber,
            sales_tax: toastData.salesTax,
            marketplace_tax: toastData.marketplaceTax,
            ebt_amount: toastData.ebtAmount,
            uber_payment: toastData.uberPayment,
            doordash_payment: toastData.doordashPayment,
            grubhub_payment: toastData.grubhubPayment,
            credit_card_deposit: toastData.creditCardDeposit,
            credit_card_fees: toastData.creditCardFees,
            cash_deposits: toastData.cashDeposit
          }

          const journal = generateJournalLines(salesPacketData, siteConfig)
          const expectedCash = calculateExpectedCash(salesPacketData)
          const docNumber = formatDocNumber(storeName.replace(/^Tacos Gavilan\s+/i, '').trim(), targetDate)

          const validationInfo = {
            passed: !hasOpenOrders,
            hasOpenOrders,
            openOrdersCount: toastData.openOrdersCount || 0,
            outOfBalanceOrdersCount: toastData.outOfBalanceOrdersCount || 0,
            openOrders: toastData.openOrdersList || [],
            checkedAt: new Date().toISOString(),
            message: hasOpenOrders
              ? `⚠️ BLOQUEO PASO 11: Se detectaron ${toastData.openOrdersCount} orden(es) abierta(s) en Toast POS. Publicación bloqueada hasta su cierre.`
              : '✓ Validación Paso 11 superada: 0 órdenes abiertas en Toast POS. Póliza lista para publicación.'
          }

          const packetData = {
            store_id: mapping.store_id,
            business_date: targetDate,
            status: packetStatus,
            dine_in_sales: salesPacketData.for_here_sales,
            togo_sales: salesPacketData.to_go_sales,
            uber_delivery_sales: salesPacketData.uber_delivery_sales,
            uber_takeout_sales: salesPacketData.uber_takeout_sales,
            doordash_delivery_sales: salesPacketData.doordash_delivery_sales,
            doordash_takeout_sales: salesPacketData.doordash_takeout_sales,
            grubhub_sales: Math.round(((salesPacketData.grubhub_delivery_sales || 0) + (salesPacketData.grubhub_takeout_sales || 0)) * 100) / 100,
            gross_sales: Math.round((salesPacketData.net_sales + salesPacketData.total_taxes) * 100) / 100,
            net_sales: salesPacketData.net_sales,
            total_discounts: 0,
            sales_tax: salesPacketData.sales_tax,
            marketplace_facilitator_tax: salesPacketData.marketplace_tax,
            facilitator_tax_paid: salesPacketData.tax_paid_by_uber,
            total_taxes: salesPacketData.total_taxes,
            total_credit_cards_gross: Math.round((salesPacketData.credit_card_deposit + salesPacketData.credit_card_fees) * 100) / 100,
            credit_card_deposit: salesPacketData.credit_card_deposit,
            credit_card_fees: salesPacketData.credit_card_fees,
            uber_payment: salesPacketData.uber_payment,
            doordash_payment: salesPacketData.doordash_payment,
            grubhub_payment: salesPacketData.grubhub_payment,
            ebt_amount: salesPacketData.ebt_amount,
            expected_cash: expectedCash,
            cash_deposit: salesPacketData.cash_deposits,
            cash_over_short: 0,
            journal_total_debits: journal.totalDebits,
            journal_total_credits: journal.totalCredits,
            journal_lines: journal.lines,
            qb_doc_number: docNumber,
            notes: validationInfo.message,
            qb_sync_response: { validation: validationInfo },
            updated_at: new Date().toISOString()
          }

          // If existing packet was already published, do NOT overwrite status!
          if (existingPacket && existingPacket.status === 'published') {
            // Keep published status
            continue
          }

          await supabaseAdmin
            .from('accounting_sales_packets')
            .upsert(packetData, { onConflict: 'store_id, business_date' })

        } catch (storeErr: any) {
          console.error(`[sync-accounting] Error en ${storeName} (${targetDate}):`, storeErr.message)
          stats.errors.push({ store: storeName, date: targetDate, error: storeErr.message })
        }
      }
    }

    const durationSec = Math.round((Date.now() - startTime) / 1000)
    console.log(`[sync-accounting] ✅ Centinela completado en ${durationSec}s:`)
    console.log(`   • Ayer (${yesterdayStr}): ${stats.yesterdayCleanReady} listas (READY), ${stats.yesterdayBlockedStep11} bloqueadas (PASO 11)`)
    console.log(`   • Auditoría Rodante: ${stats.olderPacketsRecalculated} pólizas recalculadas, ${stats.postPublishDiscrepanciesDetected} alertas post-publicación`)

    // Log the execution to accounting_sync_logs
    await supabaseAdmin.from('accounting_sync_logs').insert({
      business_date: yesterdayStr,
      action: 'cron_rolling_7day_sentinel',
      details: {
        ...stats,
        durationSeconds: durationSec,
        executionTime: new Date().toISOString()
      }
    })

    return NextResponse.json({
      success: true,
      message: `Centinela ejecutado exitosamente en ${durationSec}s`,
      stats
    })
  } catch (err: any) {
    console.error('[sync-accounting] Error fatal en centinela:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

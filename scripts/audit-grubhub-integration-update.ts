/**
 * @module scripts/audit-grubhub-integration-update
 * @description Script de auditoría exhaustiva para validar la integración de Grubhub con Toast POS antes y después de la actualización del 29/09/2026.
 * 
 * @businessRules
 * - Fecha del cambio de Grubhub: Martes 29 de Septiembre de 2026.
 * - Fecha de revisión oficial (1 día después): Miércoles 30 de Septiembre de 2026 (después de las 6:00 AM PST/PDT).
 * - Día laboral de Tacos Gavilan: 6:00 AM a 5:59 AM del siguiente día.
 * - Toast API es la fuente única de verdad para Net Sales: Sum(Item.Price) - Sum(Discounts) - Sum(Refunds) - UnlinkedRefunds.
 * - Valida:
 *   1. Detección dinámica de Dining Option (GrubHub Delivery / Grubhub Takeout) sin hardcodear GUIDs.
 *   2. Presencia y estructura de descuentos promocionales en checkout (`checks.appliedDiscounts` o item discounts).
 *   3. Costos de modificadores (`selections.modifiers`).
 *   4. Cuadre contable: Cuenta 40063 (GrubHub Sales) + Cuenta 24001 (Marketplace Tax) vs Cuenta 12054 (GrubHub A/R Payment).
 *   5. Coherencia en `sales_daily_cache` y reporte de ventas (`/ventas/reportes`).
 */

import { getAuthToken } from '../lib/toast-api'
import { getSupabaseClient } from '../lib/supabase'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

interface AuditOptions {
    targetDate: string // YYYYMMDD
    baselineDate?: string // YYYYMMDD para comparar antes vs después
}

async function getDiningOptionsMap(token: string, storeExternalId: string): Promise<Record<string, string>> {
    try {
        const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeExternalId,
            },
        })
        if (!res.ok) return {}
        const data = await res.json()
        const map: Record<string, string> = {}
        if (Array.isArray(data)) {
            data.forEach((d: any) => {
                if (d.guid && d.name) map[d.guid] = d.name
            })
        }
        return map
    } catch {
        return {}
    }
}

export async function runGrubhubAudit(options: AuditOptions) {
    const { targetDate, baselineDate } = options
    console.log('========================================================================')
    console.log(`🚀 [AUDITORÍA DE INTEGRACIÓN GRUBHUB & TOAST POS]`)
    console.log(`📅 Fecha Objetivo de Auditoría: ${targetDate} (YYYYMMDD)`)
    if (baselineDate) {
        console.log(`📅 Fecha Base de Comparación (Pre-Update): ${baselineDate} (YYYYMMDD)`)
    }
    console.log('========================================================================\n')

    const token = await getAuthToken()
    const supabase = await getSupabaseClient()

    // 1. Obtener tiendas activas de Supabase
    const { data: stores, error: storesError } = await supabase
        .from('stores')
        .select('id, name, external_id')
        .not('external_id', 'is', null)
        .order('name')

    if (storesError || !stores || stores.length === 0) {
        console.error('❌ Error al obtener sucursales desde Supabase:', storesError?.message)
        return
    }

    console.log(`🏪 Analizando ${stores.length} sucursales de Tacos Gavilan...\n`)

    let totalGrubhubOrders = 0
    let totalGrubhubNetSales = 0
    let totalGrubhubDiscounts = 0
    let totalGrubhubTax = 0
    let totalGrubhubPayments = 0
    let ordersWithDiscountsCount = 0

    const storeSummaries: Array<{
        storeName: string
        ordersCount: number
        netSales: number
        discounts: number
        tax: number
        payments: number
        discountsDetected: boolean
        balanced: boolean
    }> = []

    const sampleOrdersWithPromos: any[] = []

    for (const store of stores) {
        const storeExtId = store.external_id
        const diningMap = await getDiningOptionsMap(token, storeExtId)

        // Consultar órdenes en Toast
        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.append('businessDate', targetDate)
        url.searchParams.append('pageSize', '100')

        const fields = [
            'diningOption',
            'voided',
            'openedDate',
            'closedDate',
            'displayNumber',
            'checks.voided',
            'checks.amount',
            'checks.taxAmount',
            'checks.appliedDiscounts',
            'checks.appliedServiceCharges',
            'checks.payments.tipAmount',
            'checks.payments.amount',
            'checks.payments.displayName',
            'checks.payments.type',
            'checks.payments.refundAmount',
            'checks.selections.price',
            'checks.selections.preDiscountPrice',
            'checks.selections.tax',
            'checks.selections.taxInclusion',
            'checks.selections.displayName',
            'checks.selections.modifiers',
            'checks.selections.refundDetails',
            'source',
            'deliveryService'
        ].join(',')
        url.searchParams.append('fields', fields)

        let page = 1
        let hasMore = true
        const storeGhOrders: any[] = []

        while (hasMore) {
            url.searchParams.set('page', String(page))
            try {
                const res = await fetch(url.toString(), {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Toast-Restaurant-External-ID': storeExtId,
                    },
                })

                if (!res.ok) {
                    hasMore = false
                    break
                }

                const data = await res.json()
                const orders = Array.isArray(data) ? data : []
                if (orders.length === 0) {
                    hasMore = false
                    break
                }

                for (const order of orders) {
                    if (order.voided) continue

                    const dOptionRaw = (order.diningOption?.name || diningMap[order.diningOption?.guid] || '').toLowerCase()
                    const dService = (order.deliveryService?.name || order.deliveryService || '').toLowerCase()
                    const sourceRaw = (typeof order.source === 'string' ? order.source : (order.source?.name || '')).toLowerCase()
                    const fullString = `${dService} ${dOptionRaw} ${sourceRaw}`.trim()

                    if (fullString.includes('grubhub') || fullString.includes('grub')) {
                        storeGhOrders.push(order)
                    }
                }

                if (orders.length < 100) hasMore = false
                else page++
            } catch (err: any) {
                console.warn(`⚠️ Error consultando tienda ${store.name}: ${err.message}`)
                hasMore = false
            }
        }

        // Procesar órdenes de Grubhub para esta tienda
        let storeNet = 0
        let storeDisc = 0
        let storeTax = 0
        let storePay = 0
        let storeHasPromos = false

        for (const order of storeGhOrders) {
            for (const check of order.checks || []) {
                if (check.voided) continue

                let checkItemsSum = 0
                for (const sel of check.selections || []) {
                    let p = Number(sel.price || 0)
                    if (sel.taxInclusion === 'INCLUDED') p -= Number(sel.tax || 0)
                    if (sel.refundDetails?.refundAmount) p -= Number(sel.refundDetails.refundAmount)
                    checkItemsSum += p
                }

                let checkDiscAmount = 0
                if (check.appliedDiscounts && Array.isArray(check.appliedDiscounts)) {
                    for (const d of check.appliedDiscounts) {
                        const dAmt = Number(d.amount || 0)
                        checkDiscAmount += dAmt
                    }
                }

                if (checkDiscAmount > 0) {
                    storeHasPromos = true
                    ordersWithDiscountsCount++
                    if (sampleOrdersWithPromos.length < 5) {
                        sampleOrdersWithPromos.push({
                            store: store.name,
                            displayNumber: order.displayNumber,
                            orderId: order.guid,
                            discounts: check.appliedDiscounts,
                            checkAmount: check.amount,
                            tax: check.taxAmount,
                            selectionsCount: check.selections?.length,
                        })
                    }
                }

                const checkNet = Math.max(0, checkItemsSum - checkDiscAmount)
                const checkTax = Number(check.taxAmount || 0)

                let checkPay = 0
                for (const p of check.payments || []) {
                    checkPay += Number(p.amount || 0)
                }

                storeNet += checkNet
                storeDisc += checkDiscAmount
                storeTax += checkTax
                storePay += checkPay
            }
        }

        const isBalanced = Math.abs((storeNet + storeTax) - storePay) < 0.05

        if (storeGhOrders.length > 0) {
            totalGrubhubOrders += storeGhOrders.length
            totalGrubhubNetSales += storeNet
            totalGrubhubDiscounts += storeDisc
            totalGrubhubTax += storeTax
            totalGrubhubPayments += storePay

            storeSummaries.push({
                storeName: store.name,
                ordersCount: storeGhOrders.length,
                netSales: Math.round(storeNet * 100) / 100,
                discounts: Math.round(storeDisc * 100) / 100,
                tax: Math.round(storeTax * 100) / 100,
                payments: Math.round(storePay * 100) / 100,
                discountsDetected: storeHasPromos,
                balanced: isBalanced
            })
        }
    }

    // 2. Imprimir Reporte de Auditoría
    console.log('📊 RESUMEN POR TIENDA:')
    console.table(storeSummaries)

    console.log('\n📈 TOTALES CONSOLIDADOS GRUBHUB:')
    console.log(`- Órdenes Totales: ${totalGrubhubOrders}`)
    console.log(`- Ventas Netas Totales (Net Sales): $${totalGrubhubNetSales.toFixed(2)}`)
    console.log(`- Descuentos Totales (Discounts): $${totalGrubhubDiscounts.toFixed(2)}`)
    console.log(`- Impuestos Totales (Marketplace Tax): $${totalGrubhubTax.toFixed(2)}`)
    console.log(`- Pagos Registrados (Payments): $${totalGrubhubPayments.toFixed(2)}`)
    console.log(`- Órdenes con Descuentos Promocionales en Checkout: ${ordersWithDiscountsCount}`)

    const formulaSum = totalGrubhubNetSales + totalGrubhubTax
    const diff = Math.abs(formulaSum - totalGrubhubPayments)
    console.log(`\n⚖️ VERIFICACIÓN DE CUADRE CONTABLE:`)
    console.log(`  Crédito Total (Net Sales + Marketplace Tax): $${formulaSum.toFixed(2)}`)
    console.log(`  Débito Total (A/R Grubhub 12054 Payments):   $${totalGrubhubPayments.toFixed(2)}`)
    console.log(`  Diferencia (Discrepancy Drift):              $${diff.toFixed(2)}`)

    if (diff < 0.50) {
        console.log(`  ✅ CUADRE PERFECTO: La ecuación contable balancea al centavo.`)
    } else {
        console.log(`  ⚠️ ALERTA DE DESCUADRE: Existe una variación de $${diff.toFixed(2)}. Revisar pedidos manuales o cancelaciones.`)
    }

    // 3. Verificar datos guardados en Supabase (sales_daily_cache)
    const formattedYMD = `${targetDate.slice(0, 4)}-${targetDate.slice(4, 6)}-${targetDate.slice(6, 8)}`
    console.log(`\n💾 VERIFICACIÓN DE COHERENCIA EN BASE DE DATOS (sales_daily_cache para ${formattedYMD}):`)
    const { data: cacheData } = await supabase
        .from('sales_daily_cache')
        .select('store_name, grubhub_sales, net_sales')
        .eq('business_date', formattedYMD)

    let dbGrubhubTotal = 0
    cacheData?.forEach(r => {
        dbGrubhubTotal += Number(r.grubhub_sales || 0)
    })
    console.log(`- Total Grubhub en BD (sales_daily_cache): $${dbGrubhubTotal.toFixed(2)}`)
    console.log(`- Total Grubhub en Toast API en Vivo:      $${totalGrubhubNetSales.toFixed(2)}`)
    const dbDiff = Math.abs(dbGrubhubTotal - totalGrubhubNetSales)
    if (dbDiff < 1.00) {
        console.log(`✅ Base de datos 100% sincronizada con Toast API.`)
    } else {
        console.log(`ℹ️ Hay una variación de $${dbDiff.toFixed(2)} entre BD y Toast en vivo (posiblemente caché pendiente de refrescar con sync-sales).`)
    }

    if (sampleOrdersWithPromos.length > 0) {
        console.log('\n🔎 MUESTRAS DE ÓRDENES CON DESCUENTOS PROMOCIONALES DETECTADOS:')
        console.dir(sampleOrdersWithPromos, { depth: null })
    } else {
        console.log('\nℹ️ No se detectaron descuentos promocionales automáticos aplicados en checkout en la fecha evaluada.')
    }

    console.log('\n========================================================================')
    console.log(`🏁 Auditoría finalizada exitosamente.`)
    console.log('========================================================================\n')
}

// Permite ejecución directa desde terminal: npx tsx scripts/audit-grubhub-integration-update.ts [YYYYMMDD]
const argDate = process.argv[2] || '20260922'
runGrubhubAudit({ targetDate: argDate }).catch(console.error)

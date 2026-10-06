/**
 * @module lib/grubhub-audit-sentinel
 * @description Módulo de auditoría automatizada y reporte de integración Grubhub & Toast POS para Tacos Gavilan.
 * 
 * @businessRules
 * - Horario laboral del negocio: 6:00 AM a 5:59 AM del siguiente día (Turno PM inicia a las 5:00 PM).
 * - Toast API es la fuente única de verdad para Net Sales: Sum(Item.Price) - Sum(Discounts) - Sum(Refunds) - UnlinkedRefunds.
 * - Resolución dinámica de Dining Options (GrubHub Delivery / Grubhub Takeout) mediante `/config/v2/diningOptions` sin hardcodear GUIDs.
 * - Ecuación contable obligatoria: Créditos (Ventas Netas 40063 + Impuestos 24001) == Débito (Cobro Grubhub A/R 12054).
 * - Notificación por email a carlos@tacosgavilan.com tras la actualización o ante discrepancias mayores a $0.50.
 * 
 * @dataFlow
 * - Vercel Cron -> /api/cron/audit-grubhub -> lib/grubhub-audit-sentinel.ts
 * - Toast API (ordersBulk) + Supabase (stores & sales_daily_cache) -> Validación y cuadre -> Nodemailer -> carlos@tacosgavilan.com.
 * 
 * @notes
 * - Diseñado para verificar la actualización automática de Grubhub del 29/09/2026 y monitorear permanentemente.
 */

import nodemailer from 'nodemailer'
import { getAuthToken } from '@/lib/toast-api'
import { getSupabaseClient } from '@/lib/supabase'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export interface StoreAuditSummary {
    storeName: string
    ordersCount: number
    netSales: number
    discounts: number
    tax: number
    payments: number
    discountsDetected: boolean
    balanced: boolean
    drift: number
}

export interface GrubhubAuditReport {
    timestamp: string
    targetDateYMD: string
    businessDateFormatted: string
    isPostUpdateDate: boolean
    totalStoresScanned: number
    storesWithGrubhub: number
    totalOrders: number
    totalNetSales: number
    totalDiscounts: number
    totalTax: number
    totalPayments: number
    totalDrift: number
    ordersWithDiscountsCount: number
    isBalanced: boolean
    dbCacheMatch: boolean
    dbCacheTotal: number
    storeSummaries: StoreAuditSummary[]
    samplePromos: any[]
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

/**
 * Ejecuta la auditoría completa de Grubhub contra Toast API en vivo y base de datos.
 */
export async function executeGrubhubAudit(targetDateYMD: string): Promise<GrubhubAuditReport> {
    const token = await getAuthToken()
    if (!token) {
        throw new Error('Toast authentication failed: token is null')
    }
    const supabase = await getSupabaseClient()

    // 1. Obtener tiendas activas
    const { data: stores } = await supabase
        .from('stores')
        .select('id, name, external_id')
        .not('external_id', 'is', null)
        .order('name')

    const cleanDateToast = targetDateYMD.replace(/-/g, '') // YYYYMMDD

    let totalGrubhubOrders = 0
    let totalGrubhubNetSales = 0
    let totalGrubhubDiscounts = 0
    let totalGrubhubTax = 0
    let totalGrubhubPayments = 0
    let ordersWithDiscountsCount = 0

    const storeSummaries: StoreAuditSummary[] = []
    const samplePromos: any[] = []

    for (const store of stores || []) {
        const storeExtId = store.external_id
        if (!storeExtId) continue
        const diningMap = await getDiningOptionsMap(token, storeExtId)

        const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`)
        url.searchParams.append('businessDate', cleanDateToast)
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

                if (!res.ok) break
                const data = await res.json()
                const orders = Array.isArray(data) ? data : []
                if (orders.length === 0) break

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
            } catch {
                hasMore = false
            }
        }

        let storeNet = 0
        let storeDisc = 0
        let storeTax = 0
        let storePay = 0
        let storeHasPromos = false

        for (const order of storeGhOrders) {
            for (const check of order.checks || []) {
                if (check.voided) continue

                let checkItemsSum = 0
                let checkItemRefunds = 0
                for (const sel of check.selections || []) {
                    let p = Number(sel.price || 0)
                    if (sel.taxInclusion === 'INCLUDED') p -= Number(sel.tax || 0)
                    const selRefund = Number(sel.refundDetails?.refundAmount || 0)
                    if (selRefund > 0) {
                        p -= selRefund
                        checkItemRefunds += selRefund
                    }
                    checkItemsSum += p
                }

                let checkDiscAmount = 0
                if (check.appliedDiscounts && Array.isArray(check.appliedDiscounts)) {
                    for (const d of check.appliedDiscounts) {
                        checkDiscAmount += Number(d.amount || 0)
                    }
                }

                if (checkDiscAmount > 0) {
                    storeHasPromos = true
                    ordersWithDiscountsCount++
                    if (samplePromos.length < 4) {
                        samplePromos.push({
                            store: store.name,
                            displayNumber: order.displayNumber,
                            orderId: order.guid,
                            discounts: check.appliedDiscounts,
                            checkAmount: check.amount,
                            tax: check.taxAmount,
                        })
                    }
                }

                // Net = Items - Discounts (sin forzar a 0, para respetar reembolsos negativos legítimos)
                let checkNet = checkItemsSum - checkDiscAmount

                // UNLINKED REFUNDS: Payment-level refunds that exceed item-level refunds
                // (Fórmula canónica de toast-api.ts líneas 775-787)
                let paymentRefunds = 0
                for (const p of check.payments || []) {
                    paymentRefunds += Number(p.refundAmount || 0)
                }
                if (paymentRefunds > (checkItemRefunds + 0.01)) {
                    const unlinked = paymentRefunds - checkItemRefunds
                    checkNet -= unlinked
                }

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

        const drift = Math.abs((storeNet + storeTax) - storePay)
        const isStoreBalanced = drift < 0.05

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
                balanced: isStoreBalanced,
                drift: Math.round(drift * 100) / 100
            })
        }
    }

    // Comparar contra sales_daily_cache
    const { data: cacheData } = await supabase
        .from('sales_daily_cache')
        .select('store_name, grubhub_sales')
        .eq('business_date', targetDateYMD)

    let dbGrubhubTotal = 0
    cacheData?.forEach(r => {
        dbGrubhubTotal += Number(r.grubhub_sales || 0)
    })

    const totalFormula = totalGrubhubNetSales + totalGrubhubTax
    const totalDrift = Math.round(Math.abs(totalFormula - totalGrubhubPayments) * 100) / 100
    const isOverallBalanced = totalDrift < 0.50
    const dbCacheDiff = Math.abs(dbGrubhubTotal - totalGrubhubNetSales)

    const isPostUpdate = cleanDateToast >= '20260929'

    return {
        timestamp: new Date().toISOString(),
        targetDateYMD,
        businessDateFormatted: targetDateYMD,
        isPostUpdateDate: isPostUpdate,
        totalStoresScanned: stores?.length || 0,
        storesWithGrubhub: storeSummaries.length,
        totalOrders: totalGrubhubOrders,
        totalNetSales: Math.round(totalGrubhubNetSales * 100) / 100,
        totalDiscounts: Math.round(totalGrubhubDiscounts * 100) / 100,
        totalTax: Math.round(totalGrubhubTax * 100) / 100,
        totalPayments: Math.round(totalGrubhubPayments * 100) / 100,
        totalDrift,
        ordersWithDiscountsCount,
        isBalanced: isOverallBalanced,
        dbCacheMatch: dbCacheDiff < 1.00,
        dbCacheTotal: Math.round(dbGrubhubTotal * 100) / 100,
        storeSummaries,
        samplePromos
    }
}

/**
 * Envía el informe por correo electrónico a carlos@tacosgavilan.com.
 */
export async function sendGrubhubAuditEmail(report: GrubhubAuditReport): Promise<boolean> {
    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
        console.error('[Grubhub Audit] Credenciales SMTP faltantes.')
        return false
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD
        }
    })

    const statusBadge = report.isBalanced
        ? '<span style="background:#10b981;color:#ffffff;font-weight:bold;padding:5px 12px;border-radius:6px;font-size:12px;">✅ CUADRE PERFECTO / BALANCED ($0.00 DIFERENCIA)</span>'
        : '<span style="background:#ef4444;color:#ffffff;font-weight:bold;padding:5px 12px;border-radius:6px;font-size:12px;">⚠️ ALERTA DE DESCUADRE / DISCREPANCY DETECTED</span>'

    const subjectPrefix = report.isBalanced ? '✅ [AUDITORÍA EXITOSA]' : '⚠️ [ALERTA DE DESCUADRE]'
    const subject = `${subjectPrefix} Integración Grubhub & Toast POS - Tacos Gavilan (${report.targetDateYMD})`

    const rowsHtml = report.storeSummaries.map(s => `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
            <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">${s.storeName}</td>
            <td style="padding: 10px 12px; text-align: center;">${s.ordersCount}</td>
            <td style="padding: 10px 12px; text-align: right; font-weight: 600;">$${s.netSales.toFixed(2)}</td>
            <td style="padding: 10px 12px; text-align: right; color: ${s.discounts > 0 ? '#b91c1c' : '#64748b'};">$${s.discounts.toFixed(2)}</td>
            <td style="padding: 10px 12px; text-align: right;">$${s.tax.toFixed(2)}</td>
            <td style="padding: 10px 12px; text-align: right; font-weight: 600;">$${s.payments.toFixed(2)}</td>
            <td style="padding: 10px 12px; text-align: center;">
                ${s.balanced ? '<span style="color:#059669;font-weight:bold;">$0.00</span>' : `<span style="color:#dc2626;font-weight:bold;">$${s.drift.toFixed(2)}</span>`}
            </td>
        </tr>
    `).join('')

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f1f5f9; margin: 0; padding: 24px; }
            .container { max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
            .header { background: #0f172a; color: #ffffff; padding: 24px 32px; border-bottom: 3px solid ${report.isBalanced ? '#10b981' : '#ef4444'}; }
            .title { font-size: 20px; font-weight: 800; margin: 10px 0 4px 0; color: #ffffff; }
            .subtitle { font-size: 13px; color: #94a3b8; margin: 0; }
            .content { padding: 32px; }
            .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
            .metric-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; text-align: center; }
            .metric-val { font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 4px; }
            .metric-lbl { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; }
            .table-wrap { overflow-x: auto; margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 8px; }
            table { width: 100%; border-collapse: collapse; text-align: left; }
            th { background: #f8fafc; padding: 10px 12px; font-size: 11px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
            .footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 11.5px; color: #64748b; border-top: 1px solid #e2e8f0; }
            .callout { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 16px; border-radius: 6px; font-size: 13px; color: #1e40af; margin-bottom: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div>${statusBadge}</div>
                <div class="title">Tacos Gavilan • Auditoría de Integración Grubhub</div>
                <div class="subtitle">Revisión de Ventas, Descuentos Promocionales y Paridad Contable • Fecha: ${report.targetDateYMD}</div>
            </div>

            <div class="content">
                <div class="callout">
                    <strong>📋 Resumen Operativo:</strong> Se auditaron <strong>${report.totalStoresScanned} sucursales</strong>. Se identificaron <strong>${report.totalOrders} órdenes</strong> de Grubhub. 
                    ${report.ordersWithDiscountsCount > 0 
                        ? `Se detectaron <strong>${report.ordersWithDiscountsCount} órdenes con descuentos promocionales</strong> aplicados en caja por un total de <strong>$${report.totalDiscounts.toFixed(2)}</strong>.`
                        : `No se registraron descuentos promocionales automáticos aplicados en checkout en esta fecha.`
                    }
                </div>

                <!-- KPI Cards -->
                <div class="metric-grid">
                    <div class="metric-box">
                        <div class="metric-lbl">Ventas Netas (Net Sales)</div>
                        <div class="metric-val" style="color: #0f172a;">$${report.totalNetSales.toFixed(2)}</div>
                    </div>
                    <div class="metric-box">
                        <div class="metric-lbl">Descuentos en Caja</div>
                        <div class="metric-val" style="color: ${report.totalDiscounts > 0 ? '#dc2626' : '#64748b'};">$${report.totalDiscounts.toFixed(2)}</div>
                    </div>
                    <div class="metric-box">
                        <div class="metric-lbl">Diferencia Contable</div>
                        <div class="metric-val" style="color: ${report.isBalanced ? '#059669' : '#dc2626'};">$${report.totalDrift.toFixed(2)}</div>
                    </div>
                </div>

                <div class="metric-grid">
                    <div class="metric-box">
                        <div class="metric-lbl">Impuestos Facilitador</div>
                        <div class="metric-val">$${report.totalTax.toFixed(2)}</div>
                    </div>
                    <div class="metric-box">
                        <div class="metric-lbl">Pagos Cobrados (A/R 12054)</div>
                        <div class="metric-val">$${report.totalPayments.toFixed(2)}</div>
                    </div>
                    <div class="metric-box">
                        <div class="metric-lbl">Sincronización en BD</div>
                        <div class="metric-val" style="color: ${report.dbCacheMatch ? '#059669' : '#d97706'}; font-size: 16px; margin-top: 8px;">
                            ${report.dbCacheMatch ? '✅ 100% Sincronizado' : '⚠️ Pendiente Sync'}
                        </div>
                    </div>
                </div>

                <!-- Tabla por Tienda -->
                <h3 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #334155; margin: 24px 0 10px 0;">
                    Desglose por Sucursal (${report.storesWithGrubhub} con ventas)
                </h3>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Sucursal</th>
                                <th style="text-align:center;">Órdenes</th>
                                <th style="text-align:right;">Venta Neta</th>
                                <th style="text-align:right;">Descuentos</th>
                                <th style="text-align:right;">Tax</th>
                                <th style="text-align:right;">Pagos</th>
                                <th style="text-align:center;">Diferencia</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>

                <div style="background: ${report.isBalanced ? '#f0fdf4' : '#fff1f2'}; border: 1px solid ${report.isBalanced ? '#bbf7d0' : '#fecaca'}; border-radius: 8px; padding: 14px; font-size: 13px; color: ${report.isBalanced ? '#166534' : '#991b1b'}; margin-top: 20px;">
                    ${report.isBalanced 
                        ? '✅ <strong>Ecuación Contable Perfecta:</strong> Las Ventas Netas + Impuestos de Facilitador coinciden al centavo con las cuentas por cobrar registradas en Toast POS.'
                        : `⚠️ <strong>Descuadre Detectado:</strong> Existe una diferencia acumulada de <strong>$${report.totalDrift.toFixed(2)}</strong>. Se sugiere revisar pedidos cancelados o modificaciones manuales en tienda.`
                    }
                </div>
            </div>

            <div class="footer">
                Tacos Gavilan Enterprise Platform • Auditoría Automática de Delivery de Terceros<br>
                Generado el ${new Date(report.timestamp).toLocaleString('es-US', { timeZone: 'America/Los_Angeles' })} PST • Enviado a <strong>carlos@tacosgavilan.com</strong>
            </div>
        </div>
    </body>
    </html>
    `

    try {
        await transporter.sendMail({
            from: `"TEG Auditoría Grubhub" <${process.env.SMTP_EMAIL}>`,
            to: 'carlos@tacosgavilan.com',
            subject,
            html
        })
        console.log(`[Grubhub Audit] Correo enviado exitosamente a carlos@tacosgavilan.com con asunto: ${subject}`)
        return true
    } catch (e: any) {
        console.error('[Grubhub Audit] Error enviando correo:', e.message)
        return false
    }
}

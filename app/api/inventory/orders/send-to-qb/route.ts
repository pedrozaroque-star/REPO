/**
 * @module api/inventory/orders/send-to-qb
 * @description API route para enviar una orden de bodega a QuickBooks como Estimate.
 *              Usa el SDK node-quickbooks para crear el Estimate automáticamente.
 *
 * @businessRules
 * - Cada orden se envía como un Estimate (cotización) en QB, NO como Purchase Order
 * - Solo se envían items con cantidad final > 0
 * - El CustomerRef debe corresponder a la tienda (Lynwood-TEG por defecto)
 * - Si un item no tiene mapeo QB (qb_item_id), se omite con warning
 * - Una vez enviado, el status de la orden cambia a 'sent'
 *
 * @dataFlow
 * - Lee la orden de inventory_orders + inventory_order_lines
 * - Mapea inventory_item_id → qb_item_id via quickbooks_mappings
 * - Crea Estimate en QB via createEstimate()
 * - Guarda qb_estimate_id y qb_estimate_number en la orden
 *
 * @notes
 * - [2026-06-24] Implementación inicial. Requiere QB_LYNWOOD_CUSTOMER_ID en env vars.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { authClient } from '@/lib/quickbooks'
import QuickBooks from 'node-quickbooks'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { orderId } = body

        if (!orderId) {
            return NextResponse.json({ error: 'orderId es requerido' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // 1. Obtener la orden con sus líneas
        const { data: order, error: orderError } = await supabase
            .from('inventory_orders')
            .select('*, inventory_order_lines(*)')
            .eq('id', orderId)
            .single()

        if (orderError || !order) {
            return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })
        }

        if (order.status === 'sent') {
            return NextResponse.json({ error: 'Esta orden ya fue enviada a QuickBooks' }, { status: 400 })
        }

        // 2. Obtener nombres de items para las líneas
        const itemIds = order.inventory_order_lines.map((l: any) => l.inventory_item_id)
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name, excel_reference, order_unit_description')
            .in('id', itemIds)

        const itemMap = new Map<string, any>()
        items?.forEach(i => itemMap.set(i.id, i))

        // 3. Obtener QB mappings
        const { data: mappings } = await supabase
            .from('quickbooks_mappings')
            .select('qb_item_id, inventory_item_id')

        const qbMap = new Map<string, string>()
        mappings?.forEach(m => qbMap.set(m.inventory_item_id, m.qb_item_id))

        // 4. Obtener store info
        const { data: store } = await supabase
            .from('stores')
            .select('id, name')
            .eq('id', order.store_id)
            .single()

        // 5. Conectar a QuickBooks
        const { data: integration } = await supabase
            .from('integrations')
            .select('*')
            .eq('service_name', 'quickbooks')
            .single()

        if (!integration) {
            return NextResponse.json({ error: 'No se encontró la integración de QuickBooks' }, { status: 404 })
        }

        // Refresh token
        let accessToken = integration.access_token
        try {
            const authResponse = await authClient.refreshUsingToken(integration.refresh_token)
            const tokens = authResponse.getJson()
            accessToken = tokens.access_token

            await supabase.from('integrations').update({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                updated_at: new Date(),
            }).eq('id', integration.id)
        } catch (refreshError) {
            console.error('[QB-Order] Error refreshing token:', refreshError)
        }

        const qbo = new QuickBooks(
            process.env.QUICKBOOKS_CLIENT_ID,
            process.env.QUICKBOOKS_CLIENT_SECRET,
            accessToken,
            false,
            integration.realm_id,
            process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
            false,
            null,
            '2.0',
            integration.refresh_token
        )

        // 6. Construir el Estimate
        const estimateLines: any[] = []
        const skippedItems: string[] = []

        for (const line of order.inventory_order_lines) {
            const finalQty = line.adjusted_qty ?? line.final_qty ?? line.calculated_qty
            if (finalQty <= 0) continue // No enviar items negativos o cero

            const qbItemId = qbMap.get(line.inventory_item_id)
            if (!qbItemId) {
                const item = itemMap.get(line.inventory_item_id)
                skippedItems.push(item?.name || line.inventory_item_id)
                continue
            }

            estimateLines.push({
                DetailType: 'SalesItemLineDetail',
                Amount: 0, // QB calcula el amount basado en el precio del item
                SalesItemLineDetail: {
                    ItemRef: { value: qbItemId },
                    Qty: finalQty,
                }
            })
        }

        if (estimateLines.length === 0) {
            return NextResponse.json({
                error: 'No hay items válidos para enviar. Todos los items tienen cantidad 0 o no tienen mapeo QB.',
                skippedItems
            }, { status: 400 })
        }

        // Customer ID para la tienda (almacenar en env var o en la tabla stores)
        const customerId = process.env.QB_LYNWOOD_CUSTOMER_ID || '1'

        const estimateData = {
            CustomerRef: { value: customerId },
            TxnDate: order.order_date,
            ShipDate: order.order_date,
            CustomerMemo: { value: `Pedido ${store?.name || 'Tienda'} - ${order.order_date}` },
            Line: estimateLines,
        }

        // 7. Crear el Estimate en QB
        const estimate = await new Promise<any>((resolve, reject) => {
            qbo.createEstimate(estimateData, (err: any, result: any) => {
                if (err) reject(err)
                else resolve(result)
            })
        })

        // 8. Actualizar la orden con el ID del Estimate
        await supabase
            .from('inventory_orders')
            .update({
                status: 'sent',
                qb_estimate_id: estimate.Id,
                qb_estimate_number: estimate.DocNumber,
                sent_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId)

        console.log(`[QB-Order] ✅ Estimate #${estimate.DocNumber} creado para ${store?.name} (${order.order_date})`)

        return NextResponse.json({
            success: true,
            estimateId: estimate.Id,
            estimateNumber: estimate.DocNumber,
            linesCreated: estimateLines.length,
            skippedItems: skippedItems.length > 0 ? skippedItems : undefined
        })

    } catch (error: any) {
        console.error('[QB-Order] Error:', error)
        return NextResponse.json({
            error: error.message || 'Error al crear el Estimate en QuickBooks'
        }, { status: 500 })
    }
}

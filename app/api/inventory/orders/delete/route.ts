/**
 * @module api/inventory/orders/delete
 * @description API route para eliminar una orden de bodega y su correspondiente Estimate en QuickBooks.
 * 
 * @businessRules
 * - Si la orden ya fue enviada a QB (tiene qb_estimate_id), se elimina primero en QB via deleteEstimate
 * - Posteriormente se eliminan las líneas y la cabecera de la orden en Supabase
 * - Requiere confirmación y muestra advertencia al usuario en la UI
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

        // 1. Obtener la orden para verificar si tiene Estimate de QB
        const { data: order, error: orderError } = await supabase
            .from('inventory_orders')
            .select('*')
            .eq('id', orderId)
            .single()

        if (orderError || !order) {
            return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })
        }

        // 2. Si tiene estimate en QB, intentar eliminarlo en QB
        if (order.qb_estimate_id) {
            // Conectar a QuickBooks (sandbox con fallback a producción)
            let integration: any;
            let usingSandboxTokens = false;
            if (process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox') {
                const { getLocalSandboxIntegration } = require('@/lib/quickbooks');
                integration = getLocalSandboxIntegration();
                if (integration) {
                    usingSandboxTokens = true;
                } else {
                    console.log('[QB-Delete] No sandbox tokens, using Supabase production tokens');
                }
            }
            if (!integration) {
                const { data } = await supabase
                    .from('integrations')
                    .select('*')
                    .eq('service_name', 'quickbooks')
                    .single()
                integration = data;
            }

            if (!integration) {
                return NextResponse.json({ error: 'No se encontró la integración de QuickBooks' }, { status: 404 })
            }

            // Refresh token if expired
            let accessToken = integration.access_token
            const isExpired = new Date(integration.expires_at) <= new Date()
            if (isExpired) {
                try {
                    console.log('[QB-Delete] Token de QuickBooks expirado. Renovando...')
                    const authResponse = await authClient.refreshUsingToken(integration.refresh_token)
                    const tokens = authResponse.getJson()
                    accessToken = tokens.access_token

                    if (usingSandboxTokens) {
                        const { saveLocalSandboxIntegration } = require('@/lib/quickbooks');
                        saveLocalSandboxIntegration(tokens, integration.realm_id);
                    } else {
                        await supabase.from('integrations').update({
                            access_token: tokens.access_token,
                            refresh_token: tokens.refresh_token,
                            expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                            updated_at: new Date(),
                        }).eq('id', integration.id)
                    }
                } catch (refreshError: any) {
                    console.error('[QB-Delete] Error refreshing token:', refreshError.message)
                    return NextResponse.json({
                        error: 'token_expired',
                        reauth_url: '/api/integrations/quickbooks/auth'
                    }, { status: 401 })
                }
            }

            const qbo = new QuickBooks(
                process.env.QUICKBOOKS_CLIENT_ID,
                process.env.QUICKBOOKS_CLIENT_SECRET,
                accessToken,
                false,
                integration.realm_id,
                usingSandboxTokens ? true : false,
                false,
                null,
                '2.0',
                integration.refresh_token
            )

            // Eliminar el Estimate en QuickBooks
            try {
                console.log(`[QB-Delete] Intentando eliminar Estimate ID ${order.qb_estimate_id} en QuickBooks...`)
                await new Promise<void>((resolve, reject) => {
                    qbo.deleteEstimate(order.qb_estimate_id, (err: any) => {
                        if (err) {
                            // Si el error indica que ya no existe (404 / entity not found), podemos continuar y borrar localmente
                            const errMsg = err?.data?.fault?.error?.[0]?.message || err.message || ''
                            if (errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('does not exist')) {
                                console.warn('[QB-Delete] Estimate no existe en QB, procediendo a borrar localmente.')
                                resolve()
                            } else {
                                reject(err)
                            }
                        } else {
                            console.log(`[QB-Delete] ✅ Estimate eliminado en QuickBooks exitosamente.`)
                            resolve()
                        }
                    })
                })
            } catch (qbErr: any) {
                console.error('[QB-Delete] Error al eliminar en QuickBooks:', qbErr)
                const detailedError = qbErr?.data?.fault?.error?.[0]?.detail || qbErr.message || 'Error desconocido en QB'
                return NextResponse.json({ error: `Error en QuickBooks: ${detailedError}` }, { status: 500 })
            }
        }

        // 3. Eliminar líneas de orden de la base de datos
        const { error: deleteLinesError } = await supabase
            .from('inventory_order_lines')
            .delete()
            .eq('order_id', orderId)

        if (deleteLinesError) {
            return NextResponse.json({ error: `Error al eliminar líneas locales: ${deleteLinesError.message}` }, { status: 500 })
        }

        // 4. Eliminar cabecera de la orden
        const { error: deleteOrderError } = await supabase
            .from('inventory_orders')
            .delete()
            .eq('id', orderId)

        if (deleteOrderError) {
            return NextResponse.json({ error: `Error al eliminar la orden local: ${deleteOrderError.message}` }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (err: any) {
        console.error('[Delete-Order] Error general:', err)
        return NextResponse.json({ error: err.message || 'Error interno del servidor' }, { status: 500 })
    }
}

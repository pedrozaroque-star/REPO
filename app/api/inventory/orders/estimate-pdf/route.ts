/**
 * @module api/inventory/orders/estimate-pdf
 * @description API route para descargar o transmitir un PDF de Estimate directamente desde QuickBooks Online.
 *
 * @businessRules
 * - Exige sesión de personal autenticado (`verifyStaffAuth`, `allowCron: false`).
 * - Valida estrictamente que `estimateId` cumpla `/^[a-zA-Z0-9_-]{1,40}$/` para impedir inyección en cabeceras `Content-Disposition` o rutas de QuickBooks.
 * - Verifica alcance por sucursal (`authorizeStoreScope`) contra `inventory_orders.store_id`.
 *
 * @dataFlow
 * - `/inventory/orders` -> `GET /api/inventory/orders/estimate-pdf?estimateId=...` -> `verifyStaffAuth` + `authorizeStoreScope` -> `qbo.getEstimatePdf` -> stream `application/pdf`.
 *
 * @notes
 * - `Cache-Control: no-store` para evitar almacenamiento público de documentos internos de bodega.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getQuickBooksClient } from '@/lib/quickbooks'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server'

export async function GET(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request, { allowCron: false })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const { searchParams } = new URL(request.url)
        const rawEstimateId = searchParams.get('estimateId')
        const cleanEstimateId = rawEstimateId?.trim() || ''

        if (!cleanEstimateId) {
            return NextResponse.json({ error: 'estimateId es requerido' }, { status: 400 })
        }

        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(cleanEstimateId)) {
            return NextResponse.json({ error: 'Formato de estimateId inválido' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()
        const rawServerUser = await getServerUser(request)
        const baseRole = (rawServerUser?.role || auth.user?.role || auth.user?.user_role || '').toLowerCase()
        let effectiveStoreId = rawServerUser?.store_id ?? auth.user?.user_metadata?.store_id ?? (auth.user as any)?.store_id
        let effectiveRole = baseRole
        let effectiveScope = rawServerUser?.store_scope ?? auth.user?.user_metadata?.store_scope

        if (!effectiveStoreId && auth.user?.email && !['admin', 'administrador', 'supervisor'].includes(baseRole)) {
            const { data: userProfile } = await supabase
                .from('users')
                .select('role, store_id, store_scope')
                .ilike('email', auth.user.email)
                .maybeSingle()
            if (userProfile) {
                if (userProfile.role) effectiveRole = String(userProfile.role).trim().toLowerCase()
                if (userProfile.store_id !== null && userProfile.store_id !== undefined) effectiveStoreId = userProfile.store_id
                if (userProfile.store_scope) effectiveScope = userProfile.store_scope
            }
        }

        const serverUser = {
            id: rawServerUser?.id || auth.user!.id,
            email: rawServerUser?.email || auth.user!.email,
            name: rawServerUser?.name || auth.user!.user_metadata?.full_name || auth.user!.email,
            role: effectiveRole,
            store_id: effectiveStoreId,
            store_ids: rawServerUser?.store_ids ?? auth.user?.user_metadata?.store_ids,
            store_scope: effectiveScope,
        }

        const { data: linkedOrder } = await supabase
            .from('inventory_orders')
            .select('id, store_id')
            .eq('qb_estimate_id', cleanEstimateId)
            .limit(1)
            .maybeSingle()

        if (linkedOrder && linkedOrder.store_id !== null && linkedOrder.store_id !== undefined) {
            const scopeCheck = await authorizeStoreScope(serverUser, linkedOrder.store_id, supabase, { action: 'view' })
            if (!scopeCheck.authorized) {
                return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status })
            }
        } else if (!['admin', 'administrador', 'supervisor'].includes(effectiveRole)) {
            return NextResponse.json(
                { error: 'Acceso denegado: Estimate no vinculado a una orden autorizada para tu sucursal' },
                { status: 403 }
            )
        }

        // 1. Obtener el cliente de QuickBooks (maneja sandbox y auto-refresh de tokens)
        const qbo = await getQuickBooksClient()

        // 3. Descargar PDF desde QuickBooks
        const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            (qbo as any).getEstimatePdf(cleanEstimateId, (err: any, result: any) => {
                if (err) {
                    console.error('[QB-PDF] Error in getEstimatePdf:', err)
                    reject(err)
                } else {
                    resolve(result)
                }
            })
        })

        // 4. Stream PDF response (cast to Uint8Array for Next.js compat)
        return new NextResponse(new Uint8Array(pdfBuffer), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="estimate-${cleanEstimateId}.pdf"`,
                'Cache-Control': 'no-store'
            }
        })

    } catch (error: any) {
        console.error('[QB-PDF] Error:', error)
        let errMsg = error.message || 'Error al obtener el PDF de QuickBooks'
        
        // Extraer el detalle del error directo de QuickBooks si está disponible
        if (error.Fault?.Error?.[0]?.Detail) {
            errMsg = `Error de QuickBooks: ${error.Fault.Error[0].Detail}`
        } else if (error.response?.data?.Fault?.Error?.[0]?.Detail) {
            errMsg = `Error de QuickBooks: ${error.response.data.Fault.Error[0].Detail}`
        }
        
        return NextResponse.json({ 
            error: errMsg
        }, { status: 500 })
    }
}

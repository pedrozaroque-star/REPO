/**
 * @module api/inventory/orders/estimate-pdf
 * @description API route to download or stream an Estimate PDF directly from QuickBooks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getQuickBooksClient } from '@/lib/quickbooks'

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const estimateId = searchParams.get('estimateId')

        if (!estimateId) {
            return NextResponse.json({ error: 'estimateId es requerido' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // 1. Obtener realm_id de la integración de QuickBooks
        const { data: integration } = await supabase
            .from('integrations')
            .select('realm_id')
            .eq('service_name', 'quickbooks')
            .single()

        if (!integration?.realm_id) {
            return NextResponse.json({ error: 'No se encontró la integración de QuickBooks' }, { status: 404 })
        }

        // 2. Obtener el cliente de QuickBooks (maneja auto-refresh de tokens)
        const qbo = await getQuickBooksClient(integration.realm_id)

        // 3. Descargar PDF desde QuickBooks
        const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            qbo.getEstimatePDF(estimateId, (err: any, result: any) => {
                if (err) {
                    console.error('[QB-PDF] Error in getEstimatePDF:', err)
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
                'Content-Disposition': `inline; filename="estimate-${estimateId}.pdf"`,
                'Cache-Control': 'no-store'
            }
        })

    } catch (error: any) {
        console.error('[QB-PDF] Error:', error)
        return NextResponse.json({ 
            error: error.message || 'Error al obtener el PDF de QuickBooks' 
        }, { status: 500 })
    }
}

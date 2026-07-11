/**
 * @module api/inventory/orders/estimate-pdf
 * @description API route to download or stream an Estimate PDF directly from QuickBooks.
 */

import { NextRequest, NextResponse } from 'next/server'


import { getQuickBooksClient } from '@/lib/quickbooks'

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const estimateId = searchParams.get('estimateId')

        if (!estimateId) {
            return NextResponse.json({ error: 'estimateId es requerido' }, { status: 400 })
        }


        // 1. Obtener el cliente de QuickBooks (maneja sandbox y auto-refresh de tokens)
        const qbo = await getQuickBooksClient()

        // 3. Descargar PDF desde QuickBooks
        const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            (qbo as any).getEstimatePdf(estimateId, (err: any, result: any) => {
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
                'Content-Disposition': `inline; filename="estimate-${estimateId}.pdf"`,
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

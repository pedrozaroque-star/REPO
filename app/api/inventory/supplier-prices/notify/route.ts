/**
 * @module app/api/inventory/supplier-prices/notify/route
 * @description Endpoint para disparar el envío del correo ejecutivo de alerta de precios
 *   a los directivos de Tacos Gavilan (Roberto, Raquel, Gonzalo y Carlos).
 *
 * @businessRules
 *   - Requiere arreglo de items con aumento o toma los items del radar con diffAmount > 0.
 *   - Envía a los 4 destinatarios predeterminados o a una lista personalizada.
 *   - Devuelve confirmación de entrega y Message ID.
 *
 * @dataFlow
 *   Client POST /api/inventory/supplier-prices/notify -> sendSupplierPriceAlertEmail() -> Nodemailer -> JSON response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendSupplierPriceAlertEmail, DEFAULT_PRICE_ALERT_RECIPIENTS } from '@/lib/supplier-price-email'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      supplierName = 'Viele & Sons',
      supplierCode = 'VIELE',
      increases = [],
      netAnnualImpactUsd = 0,
      recipients = DEFAULT_PRICE_ALERT_RECIPIENTS
    } = body

    if (!increases || increases.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No se enviaron insumos con aumento de precio.'
      }, { status: 400 })
    }

    const emailResult = await sendSupplierPriceAlertEmail({
      supplierName,
      supplierCode,
      detectedAt: new Date(),
      sourceType: 'manual_review',
      increases,
      netAnnualImpactUsd,
      recipients,
      isTest: false
    })

    if (!emailResult.success) {
      return NextResponse.json({
        success: false,
        error: emailResult.error || 'Error al despachar el correo de alerta'
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      messageId: emailResult.messageId,
      recipients: emailResult.recipients,
      totalItemsNotified: increases.length,
      netAnnualImpactUsd
    })
  } catch (error: any) {
    console.error('Error in POST /api/inventory/supplier-prices/notify:', error)
    return NextResponse.json({
      success: false,
      error: error?.message || 'Error interno del servidor'
    }, { status: 500 })
  }
}

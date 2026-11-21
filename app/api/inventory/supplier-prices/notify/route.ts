/**
 * @module app/api/inventory/supplier-prices/notify/route
 * @description Endpoint autenticado para disparar el envío del correo ejecutivo de alerta de precios
 *   a los directivos de Tacos Gavilan (Roberto, Raquel, Gonzalo y Carlos).
 *
 * @businessRules
 *   - Exige sesión de personal autorizada (`verifyStaffAuth`) o `CRON_SECRET` válido.
 *   - Restringe destinatarios estrictamente a correos corporativos `@tacosgavilan.com` verificados.
 *   - Escapa todos los textos interpolados en HTML y normaliza campos numéricos para impedir inyección HTML/SMTP.
 *
 * @dataFlow
 *   Client POST /api/inventory/supplier-prices/notify -> verifyStaffAuth -> sanitización -> sendSupplierPriceAlertEmail().
 *
 * @notes
 *   - [2026-11-20] FIX CRÍTICO: Cerrado Open Corporate SMTP Relay + inyección HTML en `supplierSku`/`description`/`supplierName`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { sendSupplierPriceAlertEmail, DEFAULT_PRICE_ALERT_RECIPIENTS, type PriceChangeItem } from '@/lib/supplier-price-email'

export const dynamic = 'force-dynamic'

const NOTIFY_ALLOWED_ROLES = [
  'admin',
  'supervisor',
  'accounting',
  'contador',
  'general_manager',
  'manager',
]

const CORPORATE_EMAIL_REGEX = /^[a-z0-9._%+-]+@tacosgavilan\.com$/i

function escapeHtmlStrict(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
}

function sanitizeSupplierTitle(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/&(?!\s)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
}

function sanitizePriceChangeItems(items: unknown): PriceChangeItem[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 200).map((raw: any) => ({
    supplierSku: escapeHtmlStrict(raw?.supplierSku || ''),
    description: escapeHtmlStrict(raw?.description || ''),
    packUnit: raw?.packUnit ? escapeHtmlStrict(raw.packUnit) : undefined,
    packQuantity: Number.isFinite(Number(raw?.packQuantity)) ? Math.max(1, Number(raw.packQuantity)) : undefined,
    previousCasePrice: Number(raw?.previousCasePrice) || 0,
    newCasePrice: Number(raw?.newCasePrice) || 0,
    diffAmount: Number(raw?.diffAmount) || 0,
    changePercent: Number(raw?.changePercent) || 0,
    annualVolume: Number(raw?.annualVolume) || 0,
    annualImpactUsd: Number(raw?.annualImpactUsd) || 0,
    lastApprovedDate: typeof raw?.lastApprovedDate === 'string' ? raw.lastApprovedDate.slice(0, 40) : undefined,
  }))
}

export async function POST(request: NextRequest) {
  const auth = verifyStaffAuth(request, { allowedRoles: NOTIFY_ALLOWED_ROLES, allowCron: true })
  if (!auth.authorized) return auth.response!

  try {
    const body = await request.json()
    const supplierName = sanitizeSupplierTitle(body?.supplierName || 'Viele & Sons') || 'Viele & Sons'
    const supplierCode = escapeHtmlStrict(body?.supplierCode || 'VIELE') || 'VIELE'
    const increases = sanitizePriceChangeItems(body?.increases)
    const decreases = sanitizePriceChangeItems(body?.decreases)
    const netAnnualImpactUsd = Number(body?.netAnnualImpactUsd) || 0

    let validatedRecipients: string[] = [...DEFAULT_PRICE_ALERT_RECIPIENTS]
    if (body?.recipients !== undefined) {
      if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Lista de destinatarios inválida.' },
          { status: 400 }
        )
      }

      const normalizedRecipients: string[] = Array.from(
        new Set<string>(
          (body.recipients as unknown[])
            .map((r: unknown): string => String(r ?? '').trim().toLowerCase())
            .filter((s: string): boolean => s.length > 0)
        )
      )

      if (normalizedRecipients.length === 0 || normalizedRecipients.some((email) => !CORPORATE_EMAIL_REGEX.test(email))) {
        return NextResponse.json(
          {
            success: false,
            error: 'Destinatarios restringidos exclusivamente a cuentas corporativas @tacosgavilan.com.',
          },
          { status: 403 }
        )
      }

      const knownDefaults = new Set([
        ...DEFAULT_PRICE_ALERT_RECIPIENTS.map((e) => e.toLowerCase()),
        'carlos@tacosgavilan.com',
      ])
      const needsDbCheck = normalizedRecipients.filter((e) => !knownDefaults.has(e))
      if (needsDbCheck.length > 0) {
        const supabase = await getSupabaseAdminClient()
        const { data: activeUsers } = await supabase
          .from('users')
          .select('email')
          .in('email', needsDbCheck)
          .eq('is_active', true)
        const verifiedDbSet = new Set((activeUsers || []).map((u: any) => String(u.email || '').trim().toLowerCase()))
        const unverified = needsDbCheck.filter((e) => !verifiedDbSet.has(e))
        if (unverified.length > 0) {
          return NextResponse.json(
            {
              success: false,
              error: 'Uno o más destinatarios no pertenecen a usuarios corporativos activos de Tacos Gavilan.',
            },
            { status: 403 }
          )
        }
      }

      validatedRecipients = normalizedRecipients
    }

    if (increases.length === 0 && decreases.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No se enviaron variaciones de precios (aumentos ni rebajas) para notificar.'
      }, { status: 400 })
    }

    const emailResult = await sendSupplierPriceAlertEmail({
      supplierName,
      supplierCode,
      detectedAt: new Date(),
      sourceType: 'manual_review',
      increases,
      decreases,
      netAnnualImpactUsd,
      recipients: validatedRecipients,
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
      totalIncreasesNotified: increases.length,
      totalDecreasesNotified: decreases.length,
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

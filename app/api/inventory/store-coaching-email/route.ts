/**
 * @module app/api/inventory/store-coaching-email
 * @description Endpoint protegido (`admin` / `supervisor`) para generar y despachar
 *   (en modo `preview` o `live` hacia la Escalera de Mando completa + Supervisor Regional + Directiva)
 *   el correo operativo claro de Cuidado de Porciones y Conteo de Sobrantes Después del Cierre.
 *
 * @businessRules
 *   - Solo usuarios con rol `admin` o `supervisor` pueden invocar `POST`.
 *   - `mode` por defecto es `'preview'` (envía únicamente a `carlos@tacosgavilan.com` y `gonzalo@tacosgavilan.com`
 *     o a `previewRecipients` corporativos `@tacosgavilan.com`).
 *   - `mode === 'live'` envía a Gerente + Asistentes (`Para`) y Supervisor Regional + Gonzalo + Carlos (`CC`).
 *
 * @dataFlow
 *   `POST /api/inventory/store-coaching-email` -> `buildAndSendStorePortionCoachingEmail()`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { isValidIsoDate } from '@/lib/inventory/food-cost-sales-resolver'
import { normalizeCorporateEmail } from '@/lib/inventory/portion-control-alerts'
import { buildAndSendStorePortionCoachingEmail } from '@/lib/inventory/store-portion-coaching-email'

export async function POST(request: NextRequest) {
  try {
    const auth = verifyStaffAuth(request)
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const role = String(auth.user.role || '').toLowerCase().trim()
    if (role !== 'admin' && role !== 'supervisor') {
      return NextResponse.json({ error: 'Solo Admin o Supervisor pueden enviar correos operativos de porcionado' }, { status: 403 })
    }

    const body = await request.json()
    const storeId = Number(body?.storeId)
    const startDate = String(body?.startDate || '').trim()
    const endDate = String(body?.endDate || '').trim()
    const mode: 'preview' | 'live' = body?.mode === 'live' ? 'live' : 'preview'

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ error: 'storeId inválido' }, { status: 400 })
    }
    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
      return NextResponse.json({ error: 'Rango de fechas inválido (YYYY-MM-DD)' }, { status: 400 })
    }

    const rawPreview = Array.isArray(body?.previewRecipients) ? body.previewRecipients : undefined
    const cleanPreview = rawPreview
      ? rawPreview.map((e: unknown) => normalizeCorporateEmail(String(e || ''))).filter((e: string | null): e is string => Boolean(e))
      : undefined

    const rawExtraCc = Array.isArray(body?.extraCc) ? body.extraCc : undefined
    const cleanExtraCc = rawExtraCc
      ? rawExtraCc.map((e: unknown) => normalizeCorporateEmail(String(e || ''))).filter((e: string | null): e is string => Boolean(e))
      : undefined

    const extraNotesItems = Array.isArray(body?.extraNotesItems)
      ? body.extraNotesItems.map((x: unknown) => String(x || '').trim()).filter(Boolean)
      : undefined

    const result = await buildAndSendStorePortionCoachingEmail({
      storeId,
      startDate,
      endDate,
      mode,
      previewRecipients: cleanPreview && cleanPreview.length > 0 ? cleanPreview : undefined,
      extraCc: cleanExtraCc,
      extraNotesItems,
    })

    return NextResponse.json({ ok: true, result })
  } catch (error: any) {
    console.error('[POST /api/inventory/store-coaching-email]', error)
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 })
  }
}
